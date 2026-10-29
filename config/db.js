const mongoose = require('mongoose');
const { MONGO_URI, NODE_ENV } = require('./env');
const logger = require('../utils/logger');

const connectDB = async () => {
  try {
    console.log("STEP DB-1: Trying MongoDB connection...");
    console.log("MONGO_URI =", MONGO_URI);

    const conn = await mongoose.connect(MONGO_URI);

    console.log("STEP DB-2: MongoDB Connected");

    logger.info(
      `MongoDB Connected: ${conn.connection.host} [${NODE_ENV}]`
    );

    mongoose.connection.on('error', (err) => {
      console.error("MongoDB Runtime Error:", err.message);
    });

    mongoose.connection.on('disconnected', () => {
      console.warn("MongoDB disconnected");
    });

  } catch (error) {
   console.error("MongoDB failed:", error.message);
   process.exit(1);
}
};

module.exports = connectDB;