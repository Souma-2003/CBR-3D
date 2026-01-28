const mongoose = require('mongoose');

const ColorDescriptorSchema = new mongoose.Schema({
  histograms: {
    rgb: {
      r: [Number],
      g: [Number],
      b: [Number]
    },
    hsv: {
      h: [Number],
      s: [Number],
      v: [Number]
    }
  },
  dominantColors: [{
    rgb: [Number],
    hsv: [Number],
    proportion: Number
  }],
  moments: {
    mean: {
      r: Number,
      g: Number,
      b: Number
    },
    variance: {
      r: Number,
      g: Number,
      b: Number
    },
    skewness: {
      r: Number,
      g: Number,
      b: Number
    }
  }
});

const TextureDescriptorSchema = new mongoose.Schema({
  tamura: {
    coarseness: Number,
    contrast: Number,
    directionality: Number
  },
  gabor: [{
    orientation: Number,
    frequency: Number,
    response: Number
  }],
  lbp: {
    histogram: [Number],
    uniformity: Number
  },
  glcm: {
    contrast: Number,
    dissimilarity: Number,
    homogeneity: Number,
    energy: Number,
    correlation: Number
  }
});

const ShapeDescriptorSchema = new mongoose.Schema({
  huMoments: [Number],
  hog: {
    histogram: [Number],
    cellSize: Number,
    blockSize: Number
  },
  contourProperties: {
    area: Number,
    perimeter: Number,
    circularity: Number,
    aspectRatio: Number,
    compactness: Number
  }
});

const ObjectDescriptorSchema = new mongoose.Schema({
  imageId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Image',
    required: true
  },
  objectIndex: {
    type: Number,
    required: true
  },
  className: {
    type: String,
    required: true
  },
  confidence: {
    type: Number,
    required: true
  },
  bbox: {
    x: Number,
    y: Number,
    width: Number,
    height: Number
  },
  color: ColorDescriptorSchema,
  texture: TextureDescriptorSchema,
  shape: ShapeDescriptorSchema,
  extractedAt: {
    type: Date,
    default: Date.now
  },
  featureVector: {
    type: [Number],
    index: true
  }
});

// Index pour la recherche rapide
ObjectDescriptorSchema.index({ 'featureVector': '2dsphere' });
ObjectDescriptorSchema.index({ className: 1 });
ObjectDescriptorSchema.index({ imageId: 1, objectIndex: 1 });

module.exports = mongoose.model('ObjectDescriptor', ObjectDescriptorSchema);