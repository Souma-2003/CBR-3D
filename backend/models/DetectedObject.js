const mongoose = require('mongoose');

const detectedObjectSchema = new mongoose.Schema({
  imageId: {
    type: String,
    required: true
  },
  class_name: {
    type: String,
    required: true
  },
  confidence: {
    type: Number,
    required: true,
    min: 0,
    max: 1
  },
  bbox: {
    x1: { type: Number, required: true },
    y1: { type: Number, required: true },
    x2: { type: Number, required: true },
    y2: { type: Number, required: true },
    width: { type: Number, required: true },
    height: { type: Number, required: true }
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('DetectedObject', detectedObjectSchema);