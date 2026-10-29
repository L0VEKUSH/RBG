const mongoose = require('mongoose');

const stopSchema = new mongoose.Schema({
  name: String,
  pickupTime: String,
  dropTime: String,
  landmark: String,
  order: Number
});

const routeSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  routeNumber: {
    type: String,
    unique: true,
    trim: true
  },
  stops: [stopSchema],
  distance: Number,
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

module.exports = mongoose.model('Route', routeSchema);
