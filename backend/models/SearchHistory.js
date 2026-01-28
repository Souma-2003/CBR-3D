const mongoose = require('mongoose');

const searchHistorySchema = new mongoose.Schema({
  searchType: {
    type: String,
    enum: ['object', 'descriptor', 'yolo_detection', 'text', 'advanced'],
    required: true
  },
  queryObjectId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DetectedObject'
  },
  queryImage: String,
  className: String,
  confidence: Number,
  queryBbox: {
    x: Number,
    y: Number,
    width: Number,
    height: Number
  },
  searchMethod: {
    type: String,
    enum: ['cosine', 'euclidean', 'manhattan'],
    default: 'cosine'
  },
  threshold: {
    type: Number,
    default: 0.5
  },
  resultsCount: Number,
  results: [{
    image: String,
    similarity: Number,
    bbox: {
      x: Number,
      y: Number,
      width: Number,
      height: Number
    }
  }],
  timestamp: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('SearchHistory', searchHistorySchema);