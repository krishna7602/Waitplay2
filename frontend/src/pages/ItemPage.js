import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { useLocation } from 'react-router-dom';
import { useNavigate } from 'react-router-dom';
import socket from './socket';  // Move up one directory
import './ItemPage.css';

const ItemsPage = () => {
    const [products, setProducts] = useState([]);
    const [categories, setCategories] = useState([]);
    const [cart, setCart] = useState([]);
    const [cartItems, setCartItems] = useState([]);
    const [cartID, setCartID] = useState(null);
    const [isCartModalOpen, setCartModalOpen] = useState(false);
    const [inputCartID, setInputCartID] = useState('');
    const [quantityState, setQuantityState] = useState({});
    const [showOrderSummary, setShowOrderSummary] = useState(false);
    const [selectedProduct, setSelectedProduct] = useState(null);
    const [activeFilters, setActiveFilters] = useState(['All']);
    const [searchQuery, setSearchQuery] = useState('');
    const [newItems, setNewItems] = useState({});
    const [totalQuantity, setTotalQuantity] = useState(0);
    const [dropdownOpen, setDropdownOpen] = useState(false); // Initialize dropdown state
    const location = useLocation();
    const navigate = useNavigate();
    const queryParams = new URLSearchParams(location.search);
    const type = queryParams.get('category') || 'all';
    const category = queryParams.get('category');

    const [userID] = useState(() => {
        const storedID = localStorage.getItem("userID");
        if (storedID) return storedID;

        const newID = Math.random().toString(36).substring(2, 10);
        localStorage.setItem("userID", newID);
        return newID;
    });

    // Fetch products based on type
    useEffect(() => {
        axios
            .get(`http://localhost:5001/products?type=${type}`)
            .then((response) => setProducts(response.data))
            .catch((error) => console.error('Error fetching products:', error));
    }, [type]);

    // Fetch categories
    useEffect(() => {
        axios
            .get(`http://localhost:5001/categories?type=${type}`)
            .then((response) => setCategories(response.data))
            .catch((error) => console.error('Error fetching categories:', error));
    }, [type]);

    // Handle search functionality
    useEffect(() => {
        if (searchQuery.trim() !== '') {
            axios
                .get(`http://localhost:5001/api/search?q=${searchQuery}`)
                .then((response) => setProducts(response.data))
                .catch((error) => console.error('Error fetching search results:', error));
        } else {
            axios
                .get(`http://localhost:5001/products?type=${type}`)
                .then((response) => setProducts(response.data))
                .catch((error) => console.error('Error fetching products:', error));
        }
    }, [searchQuery, type]);

    // Initialize cart
    useEffect(() => {
        const initializeCart = async () => {
            if (cartID) return;

            let storedCartID = localStorage.getItem("cartID");
            if (!storedCartID) {
                try {
                    const response = await axios.post("http://localhost:5001/create-cart");
                    storedCartID = response.data.cartID;
                    localStorage.setItem("cartID", storedCartID);
                } catch (error) {
                    console.error("Error creating cart:", error);
                    return;
                }
            }
            setCartID(storedCartID);
        };

        initializeCart();
    }, [cartID]);

    // Reset quantityState and cart-related states on page load
    useEffect(() => {
        setQuantityState({});
        setCart([]); // Clear the cart state
        setCartItems([]); // Clear the cart items state
        setTotalQuantity(0); // Reset total quantity
        localStorage.removeItem("cartID"); // Clear cart ID from localStorage
    }, []);

    // Join cart and handle WebSocket updates
    useEffect(() => {
        if (!cartID || !userID) return;

        socket.emit("join-cart", { cartID, userID });

        const handleCartUpdate = (data) => {
            if (!Array.isArray(data.items)) {
                console.error("Invalid cart update data:", data.items);
                return;
            }
            setCartItems(data.items);

            const updatedQuantities = {};
            data.items.forEach(({ item }) => {
                const key = `${item._id}-${item.type}`;
                updatedQuantities[key] = item.quantity;
            });
            setQuantityState(updatedQuantities);
        };

        socket.on("cartUpdated", handleCartUpdate);

        return () => {
            socket.off("cartUpdated", handleCartUpdate);
        };
    }, [cartID, userID]);

    // Fetch product details for cart items
    useEffect(() => {
        if (!Array.isArray(cartItems) || cartItems.length === 0) return;

        const fetchProducts = async () => {
            const newProducts = {};
            const promises = cartItems.map(async ({ item }) => {
                try {
                    const response = await axios.get(`http://localhost:5001/product/${item._id}`);
                    newProducts[item._id] = { ...response.data, quantity: item.quantity };
                } catch (error) {
                    console.error("Error fetching product details:", error);
                }
            });

            await Promise.all(promises);
            setNewItems((prevItems) => ({ ...prevItems, ...newProducts }));
        };

        fetchProducts();
    }, [cartItems]);

    // Calculate total quantity
    useEffect(() => {
        const total = Object.values(newItems).reduce((sum, item) => sum + (item.quantity || 0), 0);
        setTotalQuantity(total);
    }, [newItems]);

    // Handle adding items
    const addItem = (item) => {
        if (cartID) {
            socket.emit("add-item", { cartID, userID, item });
        }
    };

    // Handle removing items
    const removeItem = (itemID, type) => {
        if (cartID) {
            socket.emit("remove-item", { cartID, itemID, type });
        }
    };

    // Handle quantity changes
    const handleQuantityChange = (productId, type, delta) => {
        setCart((prevCart) => {
            const key = `${productId}-${type}`;
            let newCart = [...prevCart];
    
            // Find the index of the existing item
            const existingIndex = newCart.findIndex((item) => item._id === productId && item.type === type);
    
            if (existingIndex !== -1) {
                // If item exists, update its quantity
                const updatedQuantity = Math.max(newCart[existingIndex].quantity + delta, 0);
    
                if (updatedQuantity === 0) {
                    // Remove item if quantity reaches 0
                    newCart.splice(existingIndex, 1);
                    removeItem(productId, type);
                } else {
                    newCart[existingIndex] = { ...newCart[existingIndex], quantity: updatedQuantity };
                }
            } else if (delta > 0) {
                // If item doesn't exist, add it with quantity = 1
                const product = products.find((prod) => prod._id === productId);
                if (!product) return prevCart;
    
                const newItem = {
                    _id: productId,
                    title: product.title,
                    type,
                    price: type === "Half" ? product.halfPrice : product.fullPrice,
                    quantity: 1,
                };
    
                newCart.push(newItem);
                addItem(newItem);
            } else {
                return prevCart; // If decreasing an item not in cart, return unchanged cart
            }
    
            // Emit the updated cart item to the server
            socket.emit("update-cart", {
                cartID,
                item: newCart.find((item) => item._id === productId && item.type === type),
            });
    
            // Update quantity state for UI display
            setQuantityState((prevState) => ({
                ...prevState,
                [key]: newCart.find((item) => item._id === productId && item.type === type)?.quantity || 0,
            }));
    
            return newCart;
        });
    
        // Update the cartItems state to reflect the changes
        setCartItems((prevCartItems) => {
            const updatedCartItems = [...prevCartItems];
            const itemIndex = updatedCartItems.findIndex(
                (cartItem) => cartItem.item._id === productId && cartItem.item.type === type
            );
    
            if (itemIndex !== -1) {
                updatedCartItems[itemIndex].quantity += delta;
                if (updatedCartItems[itemIndex].quantity <= 0) {
                    updatedCartItems.splice(itemIndex, 1); // Remove item if quantity is zero
                }
            } else if (delta > 0) {
                const product = products.find((prod) => prod._id === productId);
                if (product) {
                    updatedCartItems.push({
                        item: {
                            _id: productId,
                            title: product.title,
                            type,
                            price: type === 'Half' ? product.halfPrice : product.fullPrice,
                        },
                        quantity: 1,
                    });
                }
            }
    
            return updatedCartItems;
        });
    };
    
    // Calculate total quantity whenever cart changes
    useEffect(() => {
        const total = cart.reduce((sum, item) => sum + item.quantity, 0);
        setTotalQuantity(total);
    }, [cart]);

    // Function to create a new cart
    const handleCreateCart = async () => {
        try {
            const response = await axios.post("http://localhost:5001/create-cart");
            if (response.data.cartID) {
                setCartID(response.data.cartID);
                setCart([]); // Reset cart when creating a new cart
                socket.emit("join-cart", { cartID: response.data.cartID, userID });
                console.log(`User ${userID} created and joined cart ${response.data.cartID}`);
            } else {
                console.error("Cart creation failed:", response.data.message);
            }
        } catch (error) {
            console.error("Error creating cart:", error);
        }
    };

    // Function to join an existing cart
    const handleJoinCart = async () => {
        if (!inputCartID.trim()) {
            alert("Please enter a valid Cart ID");
            return;
        }

        try {
            const response = await axios.post("http://localhost:5001/join-cart", { cartID: inputCartID });
            if (response.data.success) {
                setCartID(inputCartID);
                setCart(response.data.items);
                socket.emit("join-cart", { cartID: inputCartID, userID });
                console.log(`Successfully joined cart: ${inputCartID}`);
            } else {
                alert(response.data.message || "Failed to join cart.");
            }
        } catch (error) {
            console.error("Error joining cart:", error);
            alert("Error joining cart. Please try again.");
        }
    };

    // Function to toggle the order summary
    const toggleOrderSummary = () => {
        setShowOrderSummary(!showOrderSummary);
    };

    // Function to handle placing an order
    const handlePlayOrder = () => {
        if (cart.length > 0) {
            navigate('/waitplay'); // Navigate to the play order page
        } else {
            alert('Your cart is empty. Add items to place the order.');
        }
    };

    // Filter products based on active filters
    const filteredProducts = activeFilters.includes('All')
        ? products
        : products.filter((product) => activeFilters.includes(product.category));

    return (
        <div className="app-container">
            <header className="header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 20px', background: '#fff', boxShadow: '0px 1px 5px rgba(0, 0, 0, 0.1)' }}>
                {/* Logo Section */}
                <div className="logo" style={{ display: 'flex', alignItems: 'center', gap: '10px', marginLeft: "4%" }}>
                    <img
                        src="https://via.placeholder.com/40"
                        alt="Logo"
                        style={{ width: '40px', height: '40px', borderRadius: '5px' }}
                    />
                    <span style={{ fontSize: '20px', fontWeight: 'bold', color: '#333' }}>Logo</span>
                </div>

                {/* Share or Join Cart Button */}
                <button
                    onClick={() => setCartModalOpen(true)}
                    style={{
                        background: 'linear-gradient(to right, #f54ea2, #ff7676)',
                        border: 'none',
                        padding: '10px 20px',
                        borderRadius: '20px',
                        color: '#fff',
                        fontSize: '14px',
                        cursor: 'pointer',
                        fontWeight: 'bold',
                        marginRight: "3%",
                    }}
                >
                    Share or Join Cart
                </button>
            </header>

            {/* Cart Modal */}
            {isCartModalOpen && (
                <div
                    className="modal"
                    style={{
                        position: "fixed",
                        top: 0,
                        left: 0,
                        width: "100%",
                        height: "100%",
                        background: "rgba(0, 0, 0, 0.5)",
                        display: "flex",
                        justifyContent: "center",
                        alignItems: "center",
                    }}
                >
                    <div
                        className="modal-content"
                        style={{
                            background: "#fff",
                            padding: "20px",
                            borderRadius: "10px",
                            width: "300px",
                            textAlign: "center",
                        }}
                    >
                        <h2>Share or Join Cart</h2>

                        {/* Always show Create & Share Cart button */}
                        <button
                            onClick={handleCreateCart}
                            style={{
                                padding: "10px",
                                background: "#28a745",
                                color: "#fff",
                                border: "none",
                                borderRadius: "5px",
                                cursor: "pointer",
                                marginBottom: "10px",
                                width: "100%",
                            }}
                        >
                            Create & Share Cart
                        </button>

                        <hr />

                        {/* Always show Join Cart input and button */}
                        <input
                            type="text"
                            placeholder="Enter Cart ID"
                            value={inputCartID}
                            onChange={(e) => setInputCartID(e.target.value)}
                            style={{
                                padding: "8px",
                                width: "80%",
                                marginBottom: "10px",
                                textAlign: "center",
                            }}
                        />
                        <button
                            onClick={handleJoinCart}
                            style={{
                                padding: "10px",
                                background: "#007bff",
                                color: "#fff",
                                border: "none",
                                borderRadius: "5px",
                                cursor: "pointer",
                                width: "100%",
                            }}
                        >
                            Join Cart
                        </button>

                        {/* Show Cart ID if already in a cart */}
                        {cartID && (
                            <p style={{ marginTop: "10px" }}>
                                Your Cart ID: <strong>{cartID}</strong>
                            </p>
                        )}

                        {/* Close button */}
                        <button
                            onClick={() => setCartModalOpen(false)}
                            style={{
                                marginTop: "10px",
                                padding: "10px",
                                background: "#dc3545",
                                color: "#fff",
                                border: "none",
                                borderRadius: "5px",
                                cursor: "pointer",
                                width: "100%",
                            }}
                        >
                            Close
                        </button>
                    </div>
                </div>
            )}

            <div className="search-and-call" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 20px', background: '#000', color: '#fff', marginTop: '-1px', width:"100%" }}>
                {/* Search Bar */}
                <div className="search-bar" style={{ display: 'flex', alignItems: 'center', background: '#fff', borderRadius: '10px', padding: '5px 10px', width: '75%', marginLeft: "2%" }}>
                    <input
                        type="text"
                        placeholder={searchQuery ? '' : 'Search'}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        style={{
                            border: 'none',
                            outline: 'none',
                            flexGrow: 1,
                            padding: '10px',
                            fontSize: '14px',
                            borderRadius: '5px',
                        }}
                    />
                    <img
                        src="https://s3-alpha-sig.figma.com/img/ae40/6128/f3012b96902d816d28e1503545a493ed?Expires=1737331200&Key-Pair-Id=APKAQ4GOSFWCVNEHN3O4&Signature=XrLLwUzf5QcUUbG3O-NxCw4f~35asIgdZe~lqE~xF5u3N7Bw7ezAp43p5j2gMHuc0rTStuVYalBYNjBTH5jUi~D6EXXXhhMgdbybSKr29j4a1ij1PWErqa136o1WOkFpBwysyc0pvtfGAkNcxPUMBon8upK-lva~mtkpz37fHg~L8uCPDoWOjv2XK-ItCgVcOD4NR7YAiT2am8ScyGw6R5dLHsvMCcgKzS-kqlCK5jgds17MHB8Ro2TrWYGp5uAB56~2gle0g9g5u7jUUfsBFxNzNI~4IHPl0Zx~IObkmprORe8YLtN6Ze5MZQa2kV01~pdEx4zxn~JHUXO0jFkocg__"
                        alt="Search Icon"
                        style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                    />
                </div>

                {/* Call Waiter Button */}
                <button
                    style={{
                        background: '#8e44ad',
                        position:'relative',
                        right:"2%",
                        padding: '10px 10px',
                        borderRadius: '10px',
                        color: '#fff',
                        fontSize: '15px',
                        cursor: 'pointer',
                        fontWeight: 'bold',
                        marginLeft: '15px',
                        whiteSpace: 'nowrap',
                    }}
                >Call Waiter
                </button>
            </div>

            <div className="filter-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: '10px', marginLeft: '0', paddingLeft: '0', width: '90%' }}>
                <div className="dropdown" style={{ position: 'relative', marginRight: '30px' }}>
                    <div
                        className="selected-category"
                        style={{
                            fontSize: '18px',
                            fontWeight: 'bold',
                            color: type === 'veg' ? 'green' : type === 'non-veg' ? 'red' : type === 'drinks' ? 'blue' : 'purple',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '5px',
                            cursor: 'pointer',
                        }}
                        onClick={() => setDropdownOpen((prev) => !prev)}
                    >
                        <span
                            style={{
                                display: 'inline-block',
                                width: '12px',
                                height: '12px',
                                borderRadius: '50%',
                                backgroundColor: type === 'veg' ? 'green' : type === 'non-veg' ? 'red' : type === 'drinks' ? 'blue' : 'purple',
                            }}
                        ></span>
                        {type.charAt(0).toUpperCase() + type.slice(1)}
                    </div>
                    {dropdownOpen && (
                        <ul
                            className="dropdown-menu"
                            style={{
                                position: 'absolute',
                                top: '100%',
                                left: 0,
                                backgroundColor: 'white',
                                border: '1px solid #ccc',
                                boxShadow: '0 2px 5px rgba(0, 0, 0, 0.1)',
                                zIndex: 1000,
                                listStyle: 'none',
                                padding: '10px 0',
                                margin: 0,
                                width: '150px',
                            }}
                        >
                            {["veg", "non-veg", "drinks", "icecream"]
                                .filter((category) => category.toLowerCase() !== type.toLowerCase())
                                .map((category) => (
                                    <li
                                        key={category}
                                        style={{
                                            padding: '5px 15px',
                                            cursor: 'pointer',
                                            color: category === 'non-veg' ? 'red' : category === 'drinks' ? 'blue' : category === 'icecream' ? 'purple' : 'green',
                                        }}
                                        onClick={() => {
                                            navigate(`/items?category=${category.toLowerCase()}`);
                                            setDropdownOpen(false);
                                        }}
                                    >
                                        {category.charAt(0).toUpperCase() + category.slice(1)}
                                    </li>
                                ))}
                        </ul>
                    )}
                </div>
                <div style={{ display: 'flex', overflowX: 'scroll', gap: '10px', flexGrow: 1 }}>
                    <button
                        className={`filter-button ${activeFilters.includes('All') ? 'active' : ''}`}
                        onClick={() => setActiveFilters(['All'])}
                    >
                        All
                    </button>
                    {categories.map((category) => (
                        <button
                            key={category}
                            className={`filter-button ${activeFilters.includes(category) ? 'active' : ''}`}
                            onClick={() => setActiveFilters((prevFilters) => {
                                if (prevFilters.includes(category)) {
                                    return prevFilters.filter((f) => f !== category);
                                } else {
                                    return [...prevFilters, category];
                                }
                            })}
                        >
                            {category}
                        </button>
                    ))}
                </div>
            </div>

            <main className="product-list">
                {filteredProducts.map((product) => {
                    const halfKey = `${product._id}-Half`;
                    const fullKey = `${product._id}-Full`;

                    return (
                        <div className="product-card" key={product._id}>
                            <div className="product-image-container" style={{ width: '200px', height: '200px' }}>
                                <img
                                    className="product-image"
                                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                    src={product.image}
                                    alt={product.title}
                                />
                            </div>
                            <div className="product-details">
                                <div className="product-header">
                                    <h3 className="product-title">{product.title}</h3>
                                    <span className="product-time">20min</span>
                                </div>
                                <p className="product-description">
                                    {product.description} <span className="know-more" onClick={() => setSelectedProduct(product)}>...more</span>
                                </p>
                                <div className="product-prices">
                                    <span className="price">@{product.halfPrice} Half</span>
                                    <span className="price">@{product.fullPrice} Full</span>
                                </div>

                                {/* Quantity Controls (Now using WebSocket) */}
                                <div className="product-actions">
                                    <div
                                        className="quantity-control"
                                        style={{
                                            backgroundColor: quantityState[halfKey] > 0 ? 'rgba(255, 182, 193, 0.8)' : '#f9f9f9',
                                            border: quantityState[halfKey] > 0 ? '1px solid #ff6f61' : '1px solid #ddd',
                                        }}
                                    >
                                        <span>Half</span>
                                        <button onClick={() => handleQuantityChange(product._id, 'Half', -1)}>-</button>
                                        <span>{quantityState[halfKey] || 0}</span>
                                        <button onClick={() => handleQuantityChange(product._id, 'Half', 1)}>+</button>
                                    </div>

                                    <div
                                        className="quantity-control"
                                        style={{
                                            backgroundColor: quantityState[fullKey] > 0 ? 'rgba(173, 216, 230, 0.8)' : '#f9f9f9',
                                            border: quantityState[fullKey] > 0 ? '1px solid #61a6ff' : '1px solid #ddd',
                                        }}
                                    >
                                        <span>Full</span>
                                        <button onClick={() => handleQuantityChange(product._id, 'Full', -1)}>-</button>
                                        <span>{quantityState[fullKey] || 0}</span>
                                        <button onClick={() => handleQuantityChange(product._id, 'Full', 1)}>+</button>
                                    </div>
                                </div>

                                {/*  Note to Chef */}
                                <textarea
                                    className="notes-input"
                                    style={{
                                        backgroundColor: cart.find(item => item.productId === product._id) ? 'rgba(240, 248, 255, 0.5)' : '#fff',
                                        border: '1px solid #ddd',
                                        width: '100%',
                                        marginTop: '10px',
                                        padding: '10px',
                                        borderRadius: '5px',
                                    }}
                                    placeholder="Note to chef"
                                ></textarea>
                            </div>
                        </div>
                    );
                })}
            </main>

            {selectedProduct && (
                <div className="popup-overlay">
                    <div className="product-details-popup slide-up">
                        <button onClick={() => setSelectedProduct(null)} className="close-kmore">X</button>
                        <img className="details-image" src={selectedProduct.image} alt={selectedProduct.title} />
                        <div className="details-content">
                            <h3>{selectedProduct.title}</h3>
                            <p className="details-description">{selectedProduct.detailedDescription}</p>
                            <div className="special-items">
                                <h4>Add Special Items</h4>
                                {selectedProduct.specialItems.map((item, index) => (
                                    <button key={index} className="special-item-button">{item}</button>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <footer className="cart-footer">
                <div className="cart-container">
                    <img
                        src="https://i.pinimg.com/originals/e2/06/3e/e2063ef31174bff0e81d1bb641b5f3f3.png" 
                        alt="Cart"
                        className="cart-icon"
                    />
                    <span className="cart-badge">{totalQuantity}</span>
                </div>
                <button onClick={toggleOrderSummary} className="summary-button">Order Summary</button>
                <button
                    className="place-order"
                    style={{
                        backgroundColor: cart.length === 0 ? 'grey' : 'darkgreen',
                        color: 'white',
                    }}
                    onClick={handlePlayOrder}
                >
                    Play Order
                </button>
            </footer>

            {showOrderSummary && (
                <div className="order-summary-container">
                    <div className="order-summary slide-up">
                        <div className="order-summary-header">
                            <div className="cart-container">
                                <div className= "new-cart">
                                    <img
                                        src="https://i.pinimg.com/originals/e2/06/3e/e2063ef31174bff0e81d1bb641b5f3f3.png" 
                                        alt="Cart"
                                        className="cart-icon"
                                    />
                                    <span className="cart-badge">{cart.reduce((total, item) => total + item.quantity, 0)}</span>
                                </div>
                            </div>
                            <div className="summary-text">Order Summary </div>
                            <button onClick={toggleOrderSummary} className="close-summary">X</button>
                        </div>
                        <table>
    <thead>
        <tr>
            <th>User</th>
            <th>Item</th>
            <th>Quantity</th>
            <th>Price</th>
        </tr>
    </thead>
    <tbody>
        {Object.values(
            cartItems.reduce((acc, { item }) => {
                const key = `${item._id}-${item.type}`;
                if (!acc[key]) {
                    acc[key] = { ...item, quantity: 0 };
                }
                acc[key].quantity += item.quantity;
                return acc;
            }, {})
        ).map((item) => {
            const quantityKey = `${item._id}-${item.type}`;
            return (
                <tr key={`item-${item._id}-${item.type}`}>
                    <td>{item.title} ({item.type})</td>
                    <td className="quantity-controls">
                        <button onClick={() => handleQuantityChange(item._id, item.type, -1)}>-</button>
                        <span>{quantityState[quantityKey] || item.quantity}</span>
                        <button onClick={() => handleQuantityChange(item._id, item.type, 1)}>+</button>
                    </td>
                    <td>₹{item.price}</td>
                </tr>
            );
        })}
    </tbody>

</table>


                    </div>
                </div>
            )}
        </div>
    );
};

export default ItemsPage;