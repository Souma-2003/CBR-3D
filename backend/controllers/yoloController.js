const DetectedObject = require('../models/DetectedObject');
const Image = require('../models/Image');
const SearchHistory = require('../models/SearchHistory');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const { promisify } = require('util');
const execAsync = promisify(exec);

exports.detectObjects = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Aucune image fournie' });
    }

    // Chemin vers le script Python
    const pythonScriptPath = path.join(__dirname, '../python-service/yolo_detector.py');
    const imagePath = req.file.path;
    
    // Exécuter la détection YOLO
    const { stdout, stderr } = await execAsync(`python "${pythonScriptPath}" "${imagePath}"`);
    
    if (stderr) {
      console.error('Erreur YOLO:', stderr);
      return res.status(500).json({ success: false, error: 'Erreur lors de la détection' });
    }

    const results = JSON.parse(stdout);
    
    // Sauvegarder l'image
    const savedImage = await Image.create({
      filename: req.file.filename,
      originalName: req.file.originalname,
      path: req.file.path,
      size: req.file.size,
      mimetype: req.file.mimetype,
      uploadDate: new Date()
    });

    // Sauvegarder les objets détectés
    if (results.detections && results.detections.length > 0) {
      const objectsToSave = results.detections.map(det => ({
        imageId: savedImage._id,
        class_name: det.class_name,
        confidence: det.confidence,
        bbox: {
          x1: det.bbox.x1,
          y1: det.bbox.y1,
          x2: det.bbox.x2,
          y2: det.bbox.y2,
          width: det.bbox.width,
          height: det.bbox.height
        }
      }));

      const savedObjects = await DetectedObject.insertMany(objectsToSave);
      results.savedObjects = savedObjects.map(obj => obj._id);
    }

    res.json({
      success: true,
      imageId: savedImage._id,
      ...results
    });
  } catch (error) {
    console.error('Erreur dans detectObjects:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.getAllDetectedObjects = async (req, res) => {
  try {
    const { limit = 50, page = 1, class_name } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    let query = {};
    if (class_name) {
      query.class_name = class_name;
    }
    
    const objects = await DetectedObject.find(query)
      .populate('imageId', 'filename originalName uploadDate')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    
    const total = await DetectedObject.countDocuments(query);
    
    res.json({
      success: true,
      objects,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.getImageDetectedObjects = async (req, res) => {
  try {
    const { imageId } = req.params;
    
    const objects = await DetectedObject.find({ imageId })
      .sort({ confidence: -1 });
    
    res.json({ success: true, objects });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.getAvailableClasses = async (req, res) => {
  try {
    const classes = await DetectedObject.aggregate([
      { $group: { _id: "$class_name", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $project: { name: "$_id", count: 1, _id: 0 } }
    ]);
    
    res.json({ success: true, classes });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.getDetectionStats = async (req, res) => {
  try {
    const stats = await DetectedObject.aggregate([
      {
        $group: {
          _id: null,
          totalObjects: { $sum: 1 },
          uniqueClasses: { $addToSet: "$class_name" },
          avgConfidence: { $avg: "$confidence" },
          byClass: {
            $push: {
              class: "$class_name",
              confidence: "$confidence"
            }
          }
        }
      },
      {
        $project: {
          totalObjects: 1,
          uniqueClassesCount: { $size: "$uniqueClasses" },
          avgConfidence: 1,
          classDistribution: {
            $reduce: {
              input: "$byClass",
              initialValue: {},
              in: {
                $mergeObjects: [
                  "$$value",
                  {
                    $let: {
                      vars: { cls: "$$this.class" },
                      in: {
                        "$$cls": {
                          $sum: [
                            { $ifNull: ["$$value.$$cls", 0] },
                            1
                          ]
                        }
                      }
                    }
                  }
                ]
              }
            }
          }
        }
      }
    ]);
    
    res.json({ success: true, stats: stats[0] || {} });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};