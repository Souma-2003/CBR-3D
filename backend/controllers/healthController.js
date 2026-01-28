exports.checkHealth = async (req, res) => {
  try {
    const mongoose = require('mongoose');
    
    const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
    
    res.json({
      success: true,
      message: 'Backend Node.js opérationnel',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      services: {
        nodejs: 'running',
        mongodb: dbStatus,
        python: 'http://localhost:5000'
      },
      endpoints: {
        images: '/api/images',
        upload: '/api/upload/image',
        search: '/api/search/similar',
        history: '/api/search/history',
        yolo: '/api/yolo/detect',
        objectSearch: '/api/search/object'
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};