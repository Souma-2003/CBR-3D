import { Component, OnInit, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { ImageService, Image, ImageDescriptors } from '../../core/services/image.service';
import { HttpEventType } from '@angular/common/http';

// Interfaces locales pour compatibilité
interface FrontendImage {
  id: string;
  name: string;
  url: string;
  uploadDate: Date;
  descriptors?: ImageDescriptors | null;
}

interface Stats {
  totalImages: number;
  imagesAnalyzed: number;
  lastAnalysis: Date | null;
}

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css']
})
export class DashboardComponent implements OnInit, AfterViewInit {
  // Galerie d'images
  images: FrontendImage[] = [];
  selectedImage: FrontendImage | null = null;
  
  // Upload
  selectedFile: File | null = null;
  uploadProgress = 0;
  isUploading = false;
  uploadError: string | null = null;
  
  // Calcul des descripteurs d'image
  imageDescriptors: ImageDescriptors | null = null;
  isCalculatingDescriptors = false;
  descriptorError: string | null = null;
  
  // Visualisations
  showColorPalette = true;
  showHistogram = true;
  showTextureFeatures = true;
  showShapeFeatures = true;
  showStatistics = true;
  
  // Statistiques
  stats: Stats = {
    totalImages: 0,
    imagesAnalyzed: 0,
    lastAnalysis: null
  };

  // État de chargement
  isLoading = false;

  // Histogramme
  histogramType: 'rgb' | 'hsv' = 'rgb';
  histogramBins = 8;
  
  // Références Canvas
  @ViewChild('rgbHistogramCanvas') rgbHistogramCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('hsvHistogramCanvas') hsvHistogramCanvas!: ElementRef<HTMLCanvasElement>;

  constructor(private imageService: ImageService) {}

  ngOnInit() {
    this.loadGallery();
    this.loadStats();
  }

  ngAfterViewInit() {
    setTimeout(() => {
      this.updateCharts();
    }, 100);
  }

  // Charger la galerie d'images
  loadGallery() {
    this.isLoading = true;
    this.imageService.getImages().subscribe({
      next: (images: any[]) => {
        this.images = this.convertBackendToFrontendImages(images);
        this.stats.totalImages = this.images.length;
        this.isLoading = false;
        
        this.stats.imagesAnalyzed = this.images.filter(img => img.descriptors != null).length;
      },
      error: (error: any) => {
        console.error('Erreur chargement galerie:', error);
        this.isLoading = false;
      }
    });
  }

  // Convertir les images du backend au format frontend
  private convertBackendToFrontendImages(backendImages: any): FrontendImage[] {
    console.log('📥 Données reçues du backend:', backendImages);
    
    if (backendImages && backendImages.images && Array.isArray(backendImages.images)) {
      const files = backendImages.images;
      console.log(`📸 ${files.length} fichiers trouvés:`, files);
      
      return files.map((filename: string, index: number) => {
        return {
          id: `img-${index}-${Date.now()}`,
          name: filename,
          url: `http://localhost:3000/api/images/${filename}`,
          uploadDate: new Date(),
          descriptors: null
        };
      });
    }
    
    if (Array.isArray(backendImages)) {
      return backendImages.map((item: any, index: number) => {
        if (typeof item === 'string') {
          return {
            id: `img-${index}-${Date.now()}`,
            name: item,
            url: `http://localhost:3000/api/images/${item}`,
            uploadDate: new Date(),
            descriptors: null
          };
        }
        return {
          id: item._id || item.id || item.filename || `img-${index}-${Date.now()}`,
          name: item.name || item.filename || 'Image sans nom',
          url: item.url ? this.getFullImageUrl(item.url) : 
               item.filename ? `http://localhost:3000/api/images/${item.filename}` :
               `http://localhost:3000/api/images/${item}`,
          uploadDate: new Date(item.uploadDate || item.createdAt || new Date()),
          descriptors: item.descriptors || null
        };
      });
    }
    
    console.error('❌ Format de données inattendu:', backendImages);
    return [];
  }

  // Charger les statistiques
  loadStats() {
    this.imageService.getStats().subscribe({
      next: (response: any) => {
        if (response && response.stats) {
          this.stats = {
            totalImages: response.stats.directories?.total_images || this.images.length,
            imagesAnalyzed: response.stats.database?.total_objects || this.images.filter(img => img.descriptors != null).length,
            lastAnalysis: response.stats.lastAnalysis ? new Date(response.stats.lastAnalysis) : null
          };
        }
      },
      error: (error: any) => {
        console.error('Erreur chargement stats:', error);
        this.stats.imagesAnalyzed = this.images.filter(img => img.descriptors != null).length;
      }
    });
  }

  // Sélectionner une image
  selectImage(image: FrontendImage) {
    this.selectedImage = image;
    this.descriptorError = null;
    
    if (image.descriptors) {
      this.imageDescriptors = image.descriptors;
      console.log('📊 Descripteurs chargés:', this.imageDescriptors);
      console.log('🎨 Dominant colors format:', this.imageDescriptors.color?.dominant_colors);
      console.log('📈 RGB histogram format:', this.imageDescriptors.color?.hist_rgb?.length);
      console.log('🌈 HSV histogram format:', this.imageDescriptors.color?.hist_hsv?.length);
      
      setTimeout(() => {
        this.updateCharts();
      }, 100);
    } else {
      this.imageDescriptors = null;
      this.clearCharts();
    }
  }

  // Calculer les descripteurs d'image
  calculateImageDescriptors() {
    if (!this.selectedImage) {
      this.descriptorError = 'Aucune image sélectionnée';
      return;
    }
    
    if (this.selectedImage.descriptors) {
      this.imageDescriptors = this.selectedImage.descriptors;
      this.descriptorError = null;
      console.log('✅ Descripteurs déjà calculés, affichage...');
      setTimeout(() => {
        this.updateCharts();
      }, 100);
      return;
    }
    
    this.isCalculatingDescriptors = true;
    this.descriptorError = null;
    
    console.log(`🔍 Calcul des descripteurs pour l'image: ${this.selectedImage.name}`);
    
    let imageId = this.extractFilenameFromUrl(this.selectedImage.url);
    
    if (this.selectedImage.url.startsWith('data:') || this.selectedImage.id.startsWith('temp-')) {
      this.isCalculatingDescriptors = false;
      this.descriptorError = 'Veuillez d\'abord uploader l\'image avant de l\'analyser';
      return;
    }
    
    if (!imageId) {
      imageId = this.selectedImage.name;
    }
    
    console.log(`📝 Nom de fichier utilisé pour l'analyse: ${imageId}`);
    
    this.imageService.calculateDescriptors(imageId).subscribe({
      next: (response: any) => {
        this.isCalculatingDescriptors = false;
        console.log('📦 Réponse complète:', response);
        
        if (response.success) {
          this.imageDescriptors = response.descriptors || response.data?.descriptors;
          
          if (!this.imageDescriptors) {
            this.descriptorError = 'Aucun descripteur retourné par le serveur';
            return;
          }
          
          console.log('✅ Descripteurs calculés avec succès:', this.imageDescriptors);
          
          const imageIndex = this.images.findIndex(img => img.id === this.selectedImage?.id);
          if (imageIndex !== -1) {
            this.images[imageIndex].descriptors = this.imageDescriptors;
          }
          
          this.stats.imagesAnalyzed = this.images.filter(img => img.descriptors != null).length;
          this.stats.lastAnalysis = new Date();
          
          setTimeout(() => {
            this.updateCharts();
          }, 100);
        } else {
          this.descriptorError = response.error || response.message || 'Erreur lors du calcul des descripteurs';
          console.error('❌ Erreur du serveur:', response.error);
        }
      },
      error: (error: any) => {
        this.isCalculatingDescriptors = false;
        this.descriptorError = error.message || 'Erreur lors du calcul des descripteurs';
        console.error('❌ Erreur API:', error);
        
        if (error.status === 404) {
          this.descriptorError = 'Le fichier image n\'a pas été trouvé sur le serveur. Essayez de re-uploader l\'image.';
        } else if (error.status === 500) {
          this.descriptorError = 'Erreur serveur. Vérifiez que le service Python est démarré.';
        }
      }
    });
  }

  // Extraire le nom de fichier d'une URL
  private extractFilenameFromUrl(url: string): string {
    if (!url) return '';
    
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const filename = pathname.split('/').pop() || '';
      return filename;
    } catch {
      const parts = url.split('/');
      return parts[parts.length - 1];
    }
  }

  // Gérer la sélection de fichier
  onFileSelected(event: any) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      const file = input.files[0];
      
      if (!file.type.startsWith('image/')) {
        this.uploadError = 'Veuillez sélectionner un fichier image valide';
        return;
      }

      const maxSize = 10 * 1024 * 1024;
      if (file.size > maxSize) {
        this.uploadError = 'Le fichier est trop volumineux (max 10MB)';
        return;
      }

      this.selectedFile = file;
      this.uploadError = null;
      
      const reader = new FileReader();
      reader.onload = (e: any) => {
        const tempImage: FrontendImage = {
          id: 'temp-' + Date.now(),
          name: file.name,
          url: e.target.result,
          uploadDate: new Date(),
          descriptors: null
        };
        
        this.images.unshift(tempImage);
        this.stats.totalImages = this.images.length;
        
        this.selectImage(tempImage);
      };
      reader.readAsDataURL(file);
      
      input.value = '';
    }
  }

  // Uploader l'image
  uploadImage() {
    if (!this.selectedFile) return;
    
    this.isUploading = true;
    this.uploadProgress = 0;
    this.uploadError = null;
    
    this.imageService.uploadImage(this.selectedFile).subscribe({
      next: (event: any) => {
        if (event.type === HttpEventType.UploadProgress) {
          if (event.total && event.total > 0) {
            this.uploadProgress = Math.round(100 * event.loaded / event.total);
          }
        } else if (event.type === HttpEventType.Response && event.body) {
          this.isUploading = false;
          this.uploadProgress = 100;
          
          const response = event.body;
          let uploadedImage: any;
          
          if (response.image) {
            uploadedImage = response.image;
          } else if (response.data) {
            uploadedImage = response.data;
          } else {
            uploadedImage = response;
          }
          
          const frontendImage: FrontendImage = {
            id: uploadedImage.id || uploadedImage._id || Date.now().toString(),
            name: uploadedImage.name || this.selectedFile?.name || 'Image',
            url: this.getFullImageUrl(uploadedImage.url || uploadedImage.path || uploadedImage.filename),
            uploadDate: new Date(uploadedImage.uploadDate || uploadedImage.createdAt || new Date()),
            descriptors: uploadedImage.descriptors || null
          };
          
          this.images = this.images.filter(img => !img.id.startsWith('temp-'));
          
          this.images.unshift(frontendImage);
          this.stats.totalImages = this.images.length;
          
          this.selectImage(frontendImage);
          
          this.selectedFile = null;
          
          this.loadStats();
          
          if (frontendImage.descriptors) {
            setTimeout(() => {
              this.updateCharts();
            }, 100);
          }
        }
      },
      error: (error: any) => {
        console.error('Erreur upload:', error);
        this.isUploading = false;
        this.uploadError = error.message || 'Erreur lors de l\'upload';
        
        this.images = this.images.filter(img => !img.id.startsWith('temp-'));
        this.stats.totalImages = this.images.length;
      }
    });
  }

  // Télécharger les descripteurs
  downloadDescriptors() {
    if (!this.imageDescriptors || !this.selectedImage) return;
    
    const data = {
      imageName: this.selectedImage.name,
      imageUrl: this.selectedImage.url,
      imageId: this.selectedImage.id,
      uploadDate: this.selectedImage.uploadDate,
      analysisDate: new Date(),
      descriptors: this.imageDescriptors
    };
    
    const dataStr = JSON.stringify(data, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
    const fileName = `descripteurs_${this.selectedImage.name.replace(/\.[^/.]+$/, "")}.json`;
    
    const link = document.createElement('a');
    link.href = dataUri;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // Formater la date
  formatDate(date: Date | string): string {
    const dateObj = new Date(date);
    return dateObj.toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  // Formater la taille du fichier
  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // Obtenir l'URL complète de l'image
  private getFullImageUrl(url: string): string {
    if (!url) return '';
    if (url.startsWith('http') || url.startsWith('data:')) {
      return url;
    }
    if (url.startsWith('/')) {
      return `http://localhost:3000${url}`;
    }
    return `http://localhost:3000/${url}`;
  }

  // Mettre à jour les graphiques
  updateCharts() {
    if (this.histogramType === 'rgb') {
      this.createRGBChart();
    } else {
      this.createHSVChart();
    }
  }

  // Créer le graphique RGB avec Canvas simple
  createRGBChart() {
    if (!this.rgbHistogramCanvas || !this.rgbHistogramCanvas.nativeElement) return;
    
    const canvas = this.rgbHistogramCanvas.nativeElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Effacer le canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const data = this.getRGBHistogramData();
    if (data.length === 0) return;
    
    const barWidth = canvas.width / data.length * 0.8;
    const barSpacing = canvas.width / data.length * 0.2;
    const maxValue = Math.max(0.1, ...data.map(d => Math.max(d.red, d.green, d.blue)));
    
    // Dessiner chaque barre
    data.forEach((item, index) => {
      const x = index * (barWidth + barSpacing) + barSpacing/2;
      
      // Barre rouge
      const redHeight = (item.red / maxValue) * canvas.height * 0.9;
      ctx.fillStyle = 'rgba(255, 0, 0, 0.7)';
      ctx.fillRect(x, canvas.height - redHeight, barWidth/3, redHeight);
      
      // Barre verte
      const greenHeight = (item.green / maxValue) * canvas.height * 0.9;
      ctx.fillStyle = 'rgba(0, 255, 0, 0.7)';
      ctx.fillRect(x + barWidth/3, canvas.height - greenHeight, barWidth/3, greenHeight);
      
      // Barre bleue
      const blueHeight = (item.blue / maxValue) * canvas.height * 0.9;
      ctx.fillStyle = 'rgba(0, 0, 255, 0.7)';
      ctx.fillRect(x + 2*barWidth/3, canvas.height - blueHeight, barWidth/3, blueHeight);
    });
    
    // Ajouter des labels
    ctx.fillStyle = '#000';
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    
    data.forEach((item, index) => {
      const x = index * (barWidth + barSpacing) + barWidth/2 + barSpacing/2;
      ctx.fillText((index + 1).toString(), x, canvas.height - 15);
    });
  }

  

  // Créer le graphique HSV avec Canvas simple
  createHSVChart() {
    if (!this.hsvHistogramCanvas || !this.hsvHistogramCanvas.nativeElement) return;
    
    const canvas = this.hsvHistogramCanvas.nativeElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Effacer le canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const data = this.getHSVHistogramData();
    if (data.length === 0) return;
    
    const barWidth = canvas.width / data.length * 0.8;
    const barSpacing = canvas.width / data.length * 0.2;
    const maxValue = Math.max(0.1, ...data.map(d => Math.max(d.hue, d.saturation, d.value)));
    
    // Dessiner chaque barre
    data.forEach((item, index) => {
      const x = index * (barWidth + barSpacing) + barSpacing/2;
      
      // Barre Hue (teinte)
      const hueHeight = (item.hue / maxValue) * canvas.height * 0.9;
      ctx.fillStyle = 'rgba(255, 159, 64, 0.7)'; // Orange
      ctx.fillRect(x, canvas.height - hueHeight, barWidth/3, hueHeight);
      
      // Barre Saturation
      const saturationHeight = (item.saturation / maxValue) * canvas.height * 0.9;
      ctx.fillStyle = 'rgba(153, 102, 255, 0.7)'; // Violet
      ctx.fillRect(x + barWidth/3, canvas.height - saturationHeight, barWidth/3, saturationHeight);
      
      // Barre Value (valeur/luminosité)
      const valueHeight = (item.value / maxValue) * canvas.height * 0.9;
      ctx.fillStyle = 'rgba(255, 205, 86, 0.7)'; // Jaune
      ctx.fillRect(x + 2*barWidth/3, canvas.height - valueHeight, barWidth/3, valueHeight);
    });
    
    // Ajouter des labels
    ctx.fillStyle = '#000';
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    
    data.forEach((item, index) => {
      const x = index * (barWidth + barSpacing) + barWidth/2 + barSpacing/2;
      ctx.fillText((index + 1).toString(), x, canvas.height - 15);
    });
  }

  // Effacer les graphiques
  clearCharts() {
    if (this.rgbHistogramCanvas && this.rgbHistogramCanvas.nativeElement) {
      const ctx = this.rgbHistogramCanvas.nativeElement.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, this.rgbHistogramCanvas.nativeElement.width, this.rgbHistogramCanvas.nativeElement.height);
      }
    }
    
    if (this.hsvHistogramCanvas && this.hsvHistogramCanvas.nativeElement) {
      const ctx = this.hsvHistogramCanvas.nativeElement.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, this.hsvHistogramCanvas.nativeElement.width, this.hsvHistogramCanvas.nativeElement.height);
      }
    }
  }

  // Méthodes pour les visualisations

  // Convertir RGB en hexadécimal avec validation
  getColorHex(colorArray: any): string {
    if (!colorArray || !Array.isArray(colorArray) || colorArray.length < 3) {
      return '#CCCCCC';
    }
    
    // Convertir de 0-1 à 0-255
    const r = Math.round(colorArray[0] * 255 || 0);
    const g = Math.round(colorArray[1] * 255 || 0);
    const b = Math.round(colorArray[2] * 255 || 0);
    
    const clampedR = Math.min(255, Math.max(0, r));
    const clampedG = Math.min(255, Math.max(0, g));
    const clampedB = Math.min(255, Math.max(0, b));
    
    return `#${clampedR.toString(16).padStart(2, '0')}${clampedG.toString(16).padStart(2, '0')}${clampedB.toString(16).padStart(2, '0')}`.toUpperCase();
  }



  // Obtenir les couleurs dominantes - format corrigé pour vos données
  // Obtenir les couleurs dominantes - format corrigé pour vos données
getDominantColors(): string[] {
  if (!this.imageDescriptors?.color?.dominant_colors) {
    return Array(3).fill('#CCCCCC'); // Changé de 9 à 3
  }
  
  const colors = this.imageDescriptors.color.dominant_colors;
  console.log('🎨 Raw dominant colors:', colors);
  
  // Vos données sont un tableau plat de 9 nombres (3 couleurs RGB)
  // Nous devons les diviser en groupes de 3
  const dominantColors: string[] = [];
  
  if (Array.isArray(colors) && colors.length >= 9) {
    // Les valeurs sont déjà entre 0 et 1, nous les multiplions par 255
    const r1 = Math.round(Number(colors[0]) * 255);
    const g1 = Math.round(Number(colors[1]) * 255);
    const b1 = Math.round(Number(colors[2]) * 255);
    
    const r2 = Math.round(Number(colors[3]) * 255);
    const g2 = Math.round(Number(colors[4]) * 255);
    const b2 = Math.round(Number(colors[5]) * 255);
    
    const r3 = Math.round(Number(colors[6]) * 255);
    const g3 = Math.round(Number(colors[7]) * 255);
    const b3 = Math.round(Number(colors[8]) * 255);
    
    // S'assurer que les valeurs sont entre 0 et 255
    const clamp = (value: number) => Math.min(255, Math.max(0, value));
    
    dominantColors.push(`#${clamp(r1).toString(16).padStart(2, '0')}${clamp(g1).toString(16).padStart(2, '0')}${clamp(b1).toString(16).padStart(2, '0')}`.toUpperCase());
    dominantColors.push(`#${clamp(r2).toString(16).padStart(2, '0')}${clamp(g2).toString(16).padStart(2, '0')}${clamp(b2).toString(16).padStart(2, '0')}`.toUpperCase());
    dominantColors.push(`#${clamp(r3).toString(16).padStart(2, '0')}${clamp(g3).toString(16).padStart(2, '0')}${clamp(b3).toString(16).padStart(2, '0')}`.toUpperCase());
  }
  
  // Si nous n'avons pas 3 couleurs, remplir avec des gris
  while (dominantColors.length < 3) {
    dominantColors.push('#CCCCCC');
  }
  
  console.log('🌈 Processed dominant colors (3 couleurs):', dominantColors);
  return dominantColors;
}

  // Préparer les données pour l'histogramme RGB - format corrigé
  getRGBHistogramData(): any[] {
    if (!this.imageDescriptors?.color?.hist_rgb) {
      return Array.from({length: this.histogramBins}, (_, i) => ({
        red: 0.1,
        green: 0.1,
        blue: 0.1,
        bin: i
      }));
    }
    
    const histRgb = this.imageDescriptors.color.hist_rgb;
    console.log('📊 Raw RGB histogram data:', histRgb);
    
    // Vos données ont 24 valeurs (8 bins × 3 canaux)
    const binsPerChannel = histRgb.length / 3; // Normalement 8
    const data = [];
    
    for (let i = 0; i < binsPerChannel; i++) {
      const red = Number(histRgb[i]) || 0;
      const green = Number(histRgb[i + binsPerChannel]) || 0;
      const blue = Number(histRgb[i + binsPerChannel * 2]) || 0;
      
      data.push({
        red: red,
        green: green,
        blue: blue,
        bin: i
      });
    }
    
    console.log('📈 Processed RGB histogram data:', data);
    return data;
  }

  // Préparer les données pour l'histogramme HSV - format corrigé
  getHSVHistogramData(): any[] {
    if (!this.imageDescriptors?.color?.hist_hsv) {
      return Array.from({length: this.histogramBins}, (_, i) => ({
        hue: 0.1,
        saturation: 0.1,
        value: 0.1,
        bin: i
      }));
    }
    
    const histHsv = this.imageDescriptors.color.hist_hsv;
    console.log('📊 Raw HSV histogram data:', histHsv);
    
    // Vos données ont 24 valeurs (8 bins × 3 canaux)
    const binsPerChannel = histHsv.length / 3; // Normalement 8
    const data = [];
    
    for (let i = 0; i < binsPerChannel; i++) {
      const hue = Number(histHsv[i]) || 0;
      const saturation = Number(histHsv[i + binsPerChannel]) || 0;
      const value = Number(histHsv[i + binsPerChannel * 2]) || 0;
      
      data.push({
        hue: hue,
        saturation: saturation,
        value: value,
        bin: i
      });
    }
    
    console.log('📈 Processed HSV histogram data:', data);
    return data;
  }

  // Obtenir le nombre de caractéristiques de couleur
  getColorFeatureCount(): number {
    if (!this.imageDescriptors?.color) return 0;
    
    let count = 0;
    const color = this.imageDescriptors.color;
    
    // Compter le nombre réel de valeurs
    if (color.hist_rgb) count += color.hist_rgb.length;
    if (color.hist_hsv) count += color.hist_hsv.length;
    if (color.dominant_colors) count += color.dominant_colors.length;
    if (color.moments) count += color.moments.length;
    
    return count;
  }

  // Obtenir le nombre de caractéristiques de texture
  getTextureFeatureCount(): number {
    if (!this.imageDescriptors?.texture) return 0;
    
    let count = 0;
    const texture = this.imageDescriptors.texture;
    
    // Compter le nombre réel de valeurs
    if (texture.tamura) count += texture.tamura.length;
    if (texture.gabor) count += texture.gabor.length;
    if (texture.lbp) count += texture.lbp.length;
    if (texture.glcm) count += texture.glcm.length;
    
    return count;
  }

  // Obtenir le nombre de caractéristiques de forme
  getShapeFeatureCount(): number {
    if (!this.imageDescriptors?.shape) return 0;
    
    let count = 0;
    const shape = this.imageDescriptors.shape;
    
    // Compter le nombre réel de valeurs
    if (shape.hu) count += shape.hu.length;
    if (shape.orientation_hist) count += shape.orientation_hist.length;
    if (shape.contour_props) count += shape.contour_props.length;
    
    return count;
  }

  // Obtenir la longueur du vecteur combiné
  getCombinedVectorLength(): number {
    if (!this.imageDescriptors?.combined_vector) return 0;
    return this.imageDescriptors.combined_vector.length;
  }

  // Méthodes pour vérifier si les données sont disponibles
  hasColorFeatures(): boolean {
    return !!(this.imageDescriptors?.color);
  }

  hasTextureFeatures(): boolean {
    return !!(this.imageDescriptors?.texture);
  }

  hasShapeFeatures(): boolean {
    return !!(this.imageDescriptors?.shape);
  }

  hasCombinedVector(): boolean {
    return !!(this.imageDescriptors?.combined_vector);
  }
  
  // Vérifier si l'image a été analysée
  hasBeenAnalyzed(): boolean {
    return !!this.selectedImage?.descriptors || !!this.imageDescriptors;
  }
  
  // Obtenir les valeurs de texture pour l'affichage
  getTextureValues(): any {
    if (!this.imageDescriptors?.texture) return null;
    
    return {
      tamura: this.imageDescriptors.texture.tamura,
      gabor: this.imageDescriptors.texture.gabor,
      lbp: this.imageDescriptors.texture.lbp,
      glcm: this.imageDescriptors.texture.glcm
    };
  }

  
  
  // Obtenir les valeurs de forme pour l'affichage
  getShapeValues(): any {
    if (!this.imageDescriptors?.shape) return null;
    
    return {
      hu: this.imageDescriptors.shape.hu,
      orientation_hist: this.imageDescriptors.shape.orientation_hist,
      contour_props: this.imageDescriptors.shape.contour_props
    };
  }

  

  



}

