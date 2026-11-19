const mongoose = require('mongoose');
const { MONGO_URI, NODE_ENV } = require('./env');
const logger = require('../utils/logger');
const { assertDeclaredIndexesPresent } = require('../utils/mongoose-index-policy');
const { configureMongooseForEnvironment } = require('../utils/mongoose-connection-options');

const connectDB = async () => {
  try {
    logger.info(`MongoDB connection starting [${NODE_ENV}]`);

    const mongooseConnectionOptions = configureMongooseForEnvironment(mongoose, NODE_ENV);
    const conn = await mongoose.connect(MONGO_URI, mongooseConnectionOptions);
    if (NODE_ENV === 'production') {
      await assertDeclaredIndexesPresent(Object.values(mongoose.models));
    }

    logger.info(
      `MongoDB Connected: ${conn.connection.host} [${NODE_ENV}]`
    );

    mongoose.connection.on('error', (err) => {
      console.error(`MongoDB runtime error: ${err.name || 'DatabaseError'}`);
    });

    mongoose.connection.on('disconnected', () => {
      console.warn("MongoDB disconnected");
    });

  } catch (error) {
   console.error(`MongoDB connection failed: ${error.name || 'DatabaseError'}`);
   process.exit(1);
}
};

module.exports = connectDB;
