// ==========================
// SCHÉMAS MONGODB
// ==========================

const imageSchema = new mongoose.Schema({
    filename: { type: String, unique: true, required: true },
    originalName: String,
    path: String,
    url: String,
    uploadDate: { type: Date, default: Date.now },
    size: Number,
    processed: { type: Boolean, default: false },
    descriptors_calculated: { type: Boolean, default: false }
});

// Schéma pour les objets détectés avec descripteurs
const objectSchema = new mongoose.Schema({
    image_id: { type: String, required: true, index: true },
    classe: { type: String, required: true, index: true },
    bounding_box: {
        x: { type: Number, required: true },
        y: { type: Number, required: true },
        width: { type: Number, required: true },
        height: { type: Number, required: true }
    },
    confidence: { type: Number, default: 0 },
    descripteurs: {
        couleur: [Number],        // Vecteur de caractéristiques de couleur
        texture: [Number],        // Vecteur de caractéristiques de texture
        forme: [Number],          // Vecteur de caractéristiques de forme
        cnn: [Number],           // Vecteur de caractéristiques CNN
        combined: [Number]       // Vecteur combiné (pour la recherche)
    },
    metadata: {
        extractor_version: String,
        extraction_date: { type: Date, default: Date.now },
        vector_dimensions: {
            couleur: Number,
            texture: Number,
            forme: Number,
            cnn: Number,
            total: Number
        }
    },
    created_at: { type: Date, default: Date.now }
});

const detectionSchema = new mongoose.Schema({
    filename: { type: String, required: true, index: true },
    detections: [{
        id: Number,
        class_id: Number,
        class_name: String,
        confidence: Number,
        bbox: {
            x1: Number,
            y1: Number,
            x2: Number,
            width: Number,
            height: Number,
            center_x: Number,
            center_y: Number
        }
    }],
    statistics: {
        total: Number,
        average_confidence: Number,
        max_confidence: Number,
        min_confidence: Number,
        class_distribution: mongoose.Schema.Types.Mixed
    },
    processing_time: Number,
    model_used: { type: String, default: 'yolov8n_custom' },
    created_at: { type: Date, default: Date.now }
});

const searchHistorySchema = new mongoose.Schema({
    searchType: { type: String, required: true },
    queryImage: String,
    searchMethod: String,
    threshold: Number,
    limit: Number,
    resultsCount: Number,
    processingTime: Number,
    timestamp: { type: Date, default: Date.now },
    results: mongoose.Schema.Types.Mixed
});

const Image = mongoose.model('Image', imageSchema);
const DetectedObject = mongoose.model('DetectedObject', objectSchema);
const Detection = mongoose.model('Detection', detectionSchema);
const SearchHistory = mongoose.model('SearchHistory', searchHistorySchema);