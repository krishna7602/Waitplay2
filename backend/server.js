const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const http = require('http');  // Import HTTP module
const { Server } = require('socket.io');  // Import Socket.io
const { v4: uuidv4 } = require('uuid');


dotenv.config();

const app = express();

const server = http.createServer(app);  // Create HTTP Server
app.use(cors());
app.use(express.json());

const io = new Server(server, {
  cors: {
      origin: '*',  // Allow frontend access
      methods: ['GET', 'POST']
  }
});

mongoose
.connect("mongodb+srv://Waitplay:Waitplay@cluster0.u4tx7.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0")
  .then(() => console.log('MongoDB Connected'))
  .catch((err) => console.error('MongoDB connection error:', err));

const productSchema = new mongoose.Schema({
  title: String,
  description: String,
  detailedDescription: String,
  image: String,
  isVeg: Boolean,
  price: Number,
  halfPrice: Number,
  fullPrice: Number,
  specialItems: [String],
  category: String,
  type: String,
});

const Product = mongoose.model('Product', productSchema);

// ✅ Define Cart Schema
const cartSchema = new mongoose.Schema({
  cartID: { type: String, unique: true },
  users: [String],  // Store user session IDs
  items: [
      {
          productId: String,
          title: String,
          type: String,
          price: Number,
          quantity: Number
      }
  ]
});

const Cart = mongoose.model('Cart', cartSchema);

// Fetch products with optional filter by type and category
app.get('/products', async (req, res) => {
  try {
    const { type, category } = req.query;
    let filter = {};

    if (type && type !== 'all') filter.type = type.toLowerCase();
    if (category && category !== 'all') filter.category = category.toLowerCase();

    const products = await Product.find(filter);
    res.json(products);
  } catch (err) {
    res.status(500).send('Server error: ' + err.message);
  }
});

app.get('/categories', async (req, res) => {
  try {
    const { type } = req.query;
    let filter = {};

    if (type && type !== 'all') filter.type = type.toLowerCase();

    const categories = await Product.distinct('category', filter);
    res.json(categories);
  } catch (err) {
    res.status(500).send('Server error: ' + err.message);
  }
});

// Search products by title
app.get('/api/search', async (req, res) => {
  try {
    const query = req.query.q; // Get search query from request
    const results = await Product.find({ title: { $regex: query, $options: 'i' } }); // Case-insensitive search
    res.json(results);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching search results', error: error.message });
  }
});

let carts = {};

// API to Create a Cart and Generate a Unique ID
app.post("/create-cart", (req, res) => {
  const cartID = uuidv4(); // Generate unique ID
  carts[cartID] = { items: [], users: [] };
  res.json({ cartID, message: "Cart created successfully" });
});


app.get('/product/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Validate if 'id' is a valid MongoDB ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid product ID' });
    }

    const product = await Product.findById(id).lean();
    
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    res.json(product);
  } catch (err) {
    console.error('Error fetching product:', err);  // Log full error
    res.status(500).json({ message: 'Internal server error', error: err.message });
  }
});



// API to Join a Cart
app.post("/join-cart", async (req, res) => {
  const { cartID } = req.body;

  if (!cartID) {
      return res.status(400).json({ success: false, message: "Cart ID is required" });
  }

  // Assuming you're storing carts in memory or a database
  const cart = carts[cartID]; // If using an in-memory object

  if (!cart) {
      return res.status(404).json({ success: false, message: "Cart not found" });
  }

  return res.json({ success: true, items: cart.items });
});


// WebSocket Logic for Real-Time Updates
io.on("connection", (socket) => {
    console.log("A user connected:", socket.id);

    socket.on("user-login", ({ userID }) => {
        if (!userID) return;

        let existingCartID = Object.keys(carts).find(cartID => carts[cartID].users.includes(userID));

        if (!existingCartID) {
            existingCartID = uuidv4(); // Create a new cart if none exists
            carts[existingCartID] = { items: [], users: [userID] };
        } else {
            if (!carts[existingCartID].users.includes(userID)) {
                carts[existingCartID].users.push(userID);
            }
        }

        socket.join(existingCartID);

        // Send cart ID to user
        socket.emit("cartAssigned", { cartID: existingCartID, items: carts[existingCartID].items });

        io.to(existingCartID).emit("cartUpdated", carts[existingCartID]);
    });

    socket.on("join-cart", ({ cartID, userID }) => {
        if (!userID || !cartID) return;

        socket.join(cartID);

        if (!carts[cartID]) {
            carts[cartID] = { items: [], users: [] };
        }
        if (!carts[cartID].users.includes(userID)) {
            carts[cartID].users.unshift(userID); // Latest user appears first
        }

        io.to(cartID).emit("cartUpdated", carts[cartID]);
    });

    socket.on("add-item", ({ cartID, userID, item }) => {
        if (!cartID || !userID || !item) return;

        if (!carts[cartID]) {
            carts[cartID] = { items: [], users: [] };
        }

        // Find existing item in cart
        const existingItem = carts[cartID].items.find(
            (cartItem) => cartItem.item._id === item._id && cartItem.item.type === item.type
        );

        if (existingItem) {
            // If the item exists, increase the quantity
            existingItem.quantity += item.quantity;
        } else {
            // If the item doesn't exist, add it to the cart
            carts[cartID].items.push({ item: item, userID: userID, quantity: item.quantity });
        }

        io.to(cartID).emit("cartUpdated", carts[cartID]);  // Send updated cart to all users
    });

    socket.on("remove-item", ({ cartID, itemID, type }) => {
        if (!cartID || !itemID) return;

        // Find the index of the item to remove
        const itemIndex = carts[cartID].items.findIndex(item => item.item._id === itemID && item.item.type === type);

        if (itemIndex > -1) {
            // If the item is found, remove it from the cart
            carts[cartID].items.splice(itemIndex, 1);

            // Broadcast the removal to everyone in the same cart
            io.to(cartID).emit("cartUpdated", carts[cartID]);
        }
    });

    socket.on("update-cart", ({ cartID, item }) => {
        if (!cartID || !item) return;

        if (!carts[cartID]) return;

        // Find the item in the cart
        const itemIndex = carts[cartID].items.findIndex(cartItem => cartItem.item._id === item._id && cartItem.item.type === item.type);

        if (itemIndex === -1) return;

        // Update the quantity of the item
        carts[cartID].items[itemIndex].quantity = item.quantity;

        // Remove the item if quantity is zero
        if (item.quantity === 0) {
            carts[cartID].items.splice(itemIndex, 1);
        }

        io.to(cartID).emit("cartUpdated", carts[cartID]);  // Send updated cart to all users
    });

    socket.on("disconnect", () => {
        console.log("A user disconnected:", socket.id);
    });
});


const PORT = process.env.PORT || 5001;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
