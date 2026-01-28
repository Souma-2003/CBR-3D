import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, throwError, forkJoin } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

@Injectable({
  providedIn: 'root'
})
export class YoloService {
  private pythonServiceUrl = 'http://localhost:5000/api';
  private backendApiUrl = 'http://localhost:3000/api';

  constructor(private http: HttpClient) { }

  /**
   * Détecter des objets avec paramètres ET obtenir l'image annotée
   */
  detectObjectsWithAnnotatedImage(imageFile: File, params: any): Observable<any> {
    const formData = new FormData();
    formData.append('image', imageFile);
    formData.append('conf', params.confidence?.toString() || params.conf?.toString() || '0.25');
    formData.append('iou', params.iou?.toString() || '0.6');
    formData.append('imgsz', params.imageSize?.toString() || params.imgsz?.toString() || '640');
    formData.append('return_image', 'true'); // Demander l'image annotée

    return this.http.post(`${this.pythonServiceUrl}/detect`, formData).pipe(
      map((response: any) => {
        // Si l'API retourne l'image annotée en base64
        if (response.annotated_image) {
          const annotatedImage = 'data:image/jpeg;base64,' + response.annotated_image;
          return {
            detectionResults: response,
            annotatedImage: annotatedImage
          };
        }
        return { detectionResults: response };
      }),
      catchError(this.handleError)
    );
  }

  /**
   * Détecter des objets et sauvegarder les résultats
   */
  detectObjects(imageFile: File, saveResults: boolean = true): Observable<any> {
    const formData = new FormData();
    formData.append('image', imageFile);
    formData.append('save_results', saveResults.toString());

    return this.http.post(`${this.pythonServiceUrl}/detect`, formData)
      .pipe(
        catchError(this.handleError)
      );
  }

  /**
   * Détecter avec paramètres
   */
  detectObjectsWithParams(imageFile: File, params: any): Observable<any> {
    const formData = new FormData();
    formData.append('image', imageFile);
    formData.append('conf', params.confidence?.toString() || '0.25');
    formData.append('iou', params.iou?.toString() || '0.6');
    formData.append('imgsz', params.imageSize?.toString() || '640');

    return this.http.post(`${this.pythonServiceUrl}/detect`, formData)
      .pipe(
        catchError(this.handleError)
      );
  }

  /**
   * Obtenir l'image annotée avec paramètres
   */
  getAnnotatedImageWithParams(imageFile: File, params: any): Observable<Blob> {
    const formData = new FormData();
    formData.append('image', imageFile);
    
    // Ajouter les paramètres si fournis
    if (params.confidence !== undefined) formData.append('conf', params.confidence.toString());
    if (params.iou !== undefined) formData.append('iou', params.iou.toString());
    if (params.imageSize !== undefined) formData.append('imgsz', params.imageSize.toString());

    return this.http.post(`${this.pythonServiceUrl}/annotate`, formData, {
      responseType: 'blob'
    }).pipe(
      catchError(this.handleError)
    );
  }

  /**
   * Obtenir l'image annotée (sans paramètres)
   */
  getAnnotatedImage(imageFile: File): Observable<Blob> {
    const formData = new FormData();
    formData.append('image', imageFile);

    return this.http.post(`${this.pythonServiceUrl}/annotate`, formData, {
      responseType: 'blob'
    }).pipe(
      catchError(this.handleError)
    );
  }

  /**
   * Vérifier la santé du service
   */
  checkHealth(): Observable<any> {
    return this.http.get(`${this.pythonServiceUrl}/health`)
      .pipe(
        catchError(this.handleError)
      );
  }

  /**
   * Obtenir les classes
   */
  getClasses(): Observable<any> {
    return this.http.get(`${this.pythonServiceUrl}/classes`)
      .pipe(
        catchError(this.handleError)
      );
  }

  /**
   * Obtenir tous les objets détectés depuis la base de données
   */
  getAllDetectedObjects(limit: number = 100, page: number = 1): Observable<any> {
    return this.http.get(`${this.backendApiUrl}/yolo/objects?limit=${limit}&page=${page}`)
      .pipe(
        catchError(this.handleError)
      );
  }

  /**
   * Obtenir les détections d'une image spécifique
   */
  getImageDetections(imageId: string): Observable<any> {
    return this.http.get(`${this.backendApiUrl}/yolo/detections/${imageId}`)
      .pipe(
        catchError(this.handleError)
      );
  }

  /**
   * Obtenir les statistiques de détection
   */
  getDetectionStats(): Observable<any> {
    return this.http.get(`${this.backendApiUrl}/yolo/stats`)
      .pipe(
        catchError(this.handleError)
      );
  }

  /**
   * Sauvegarder les résultats de détection dans la base de données
   */
  saveDetectionResults(detections: any, imageId: string, filename: string): Observable<any> {
    const formData = new FormData();
    
    // Ajouter les données
    formData.append('imageId', imageId);
    formData.append('detections', JSON.stringify(detections));
    formData.append('timestamp', new Date().toISOString());
    
    // Si vous avez un fichier, l'ajouter
    if (filename) {
      // Note: Vous devriez avoir un fichier à uploader
      // formData.append('image', imageFile, filename);
    }

    return this.http.post(`${this.backendApiUrl}/yolo/save-detections`, formData)
      .pipe(
        catchError(this.handleError)
      );
  }

  /**
   * Obtenir les classes d'objets uniques
   */
  getObjectClasses(): Observable<any> {
    return this.http.get(`${this.backendApiUrl}/search/objects/classes`)
      .pipe(
        catchError(this.handleError)
      );
  }

  /**
   * Rechercher par classe d'objet
   */
  searchByObjectClass(className: string, limit: number = 10): Observable<any> {
    return this.http.post(`${this.backendApiUrl}/search/object`, {
      class_name: className,
      limit: limit
    }).pipe(
      catchError(this.handleError)
    );
  }

  /**
   * Rechercher par objet spécifique
   */
  searchByObjectId(objectId: string, limit: number = 10): Observable<any> {
    return this.http.post(`${this.backendApiUrl}/search/object`, {
      objectId: objectId,
      limit: limit
    }).pipe(
      catchError(this.handleError)
    );
  }

  /**
   * Préparer des données pour le graphique
   */
  prepareSimpleData(detections: any[]): any {
    const classCounts: { [key: string]: number } = {};
    
    detections.forEach(detection => {
      const className = detection.class_name;
      classCounts[className] = (classCounts[className] || 0) + 1;
    });

    return {
      labels: Object.keys(classCounts),
      counts: Object.values(classCounts),
      colors: this.generateColors(Object.keys(classCounts).length)
    };
  }

  /**
   * Obtenir l'URL complète d'une image
   */
  getImageUrl(filename: string): string {
    if (filename && !filename.startsWith('http')) {
      return `http://localhost:3000/uploads/images/${filename}`;
    }
    return filename;
  }

  /**
   * Formater les détections pour l'affichage
   */
  formatDetections(detections: any[]): any[] {
    return detections.map(detection => ({
      ...detection,
      formatted_confidence: this.formatPercentage(detection.confidence),
      image_url: this.getImageUrl(detection.filename || detection.image?.filename)
    }));
  }

  /**
   * Formater un pourcentage
   */
  formatPercentage(value: number): string {
    return (value * 100).toFixed(1) + '%';
  }

  /**
   * Générer des couleurs pour le graphique
   */
  private generateColors(count: number): string[] {
    const colors = [];
    for (let i = 0; i < count; i++) {
      const hue = (i * 137.508) % 360; // Utiliser l'angle d'or
      colors.push(`hsl(${hue}, 70%, 60%)`);
    }
    return colors;
  }

  /**
   * Gestion des erreurs
   */
  private handleError(error: any): Observable<never> {
    let errorMessage = 'Une erreur est survenue';
    
    if (error.error instanceof ErrorEvent) {
      errorMessage = `Erreur: ${error.error.message}`;
    } else if (error.status === 0) {
      errorMessage = 'Service non disponible. Vérifiez que les services sont en cours d\'exécution.';
    } else if (error.status === 404) {
      errorMessage = 'Service non trouvé';
    } else if (error.status === 500) {
      errorMessage = 'Erreur interne du serveur';
    } else if (error.error && error.error.message) {
      errorMessage = error.error.message;
    } else if (error.message) {
      errorMessage = error.message;
    } else {
      errorMessage = `Code d'erreur: ${error.status}`;
    }
    
    console.error('YoloService Error:', error);
    return throwError(() => new Error(errorMessage));
  }
}