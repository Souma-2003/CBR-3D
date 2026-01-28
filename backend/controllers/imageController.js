const fs = require('fs');
const path = require('path');

const ImageController = {
  // Lister toutes les images
  listImages: async (req, res) => {
    try {
      const imagesDir = path.join(__dirname, '..', 'uploads', 'images');
      
      if (!fs.existsSync(imagesDir)) {
        return res.json({ images: [], total: 0 });
      }
      
      const files = fs.readdirSync(imagesDir)
        .filter(file => /\.(jpg|jpeg|png|gif|bmp)$/i.test(file))
        .map((file, index) => {
          const filePath = path.join(imagesDir, file);
          const stats = fs.statSync(filePath);
          
          return {
            id: (index + 1).toString(),
            filename: file,
            url: `/uploads/images/${file}`,
            fullUrl: `http://localhost:${process.env.PORT || 3000}/uploads/images/${file}`,
            uploadDate: stats.mtime.toISOString(),
            size: stats.size,
            metadata: {
              filename: file
            }
          };
        });
      
      res.json({
        success: true,
        images: files,
        total: files.length
      });
    } catch (error) {
      console.error('Error listing images:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Erreur serveur' 
      });
    }
  },

  // Appliquer une transformation (simulée)
  applyTransformation: (req, res) => {
    try {
      const { imageId, transformation } = req.body;
      
      // Simuler une transformation
      res.json({
        success: true,
        message: `Transformation '${transformation}' appliquée à l'image ${imageId}`,
        data: {
          originalId: imageId,
          transformedUrl: `/uploads/processed/${imageId}-${transformation}.jpg`,
          transformation: transformation,
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  },

  // Supprimer une image
  deleteImage: (req, res) => {
    try {
      const { id } = req.params;
      const imagesDir = path.join(__dirname, '..', 'uploads', 'images');
      
      // Dans une vraie app, on aurait une base de données
      // Pour l'instant, on simule la suppression
      res.json({
        success: true,
        message: `Image ${id} supprimée (simulation)`,
        deletedId: id
      });
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }
};

module.exports = ImageController;