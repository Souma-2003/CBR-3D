import { Injectable } from '@angular/core';
import { HttpClient, HttpEvent, HttpRequest, HttpResponse, HttpEventType } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map, tap } from 'rxjs/operators';

// Interfaces
export interface Image {
  id: string;
  name: string;
  url: string;
  uploadDate: Date;
  descriptors?: ImageDescriptors | null;
}

export interface ImageDescriptors {
  // Anciens champs (pour compatibilité)
  colors?: string[];
  histogram?: number[];
  metadata?: {
    width?: number;
    height?: number;
    format?: string;
    size?: string;
    channels?: number;
    [key: string]: any;
  };
  
  // Nouveaux champs pour correspondre au backend Python
  color?: {
    hist_rgb?: number[];
    hist_hsv?: number[];
    dominant_colors?: number[][];
    moments?: number[];
  };
  
  texture?: {
    tamura?: number[];
    gabor?: number[];
    lbp?: number[];
    glcm?: number[];
  };
  
  shape?: {
    hu?: number[];
    orientation_hist?: number[];
    contour_props?: number[];
  };
  
  combined_vector?: number[];
  visualizations?: {
    color_palette?: string[];
    histogram_data?: any;
    dominant_colors?: any[];
  };
}

export interface UploadResponse {
  image: Image;
  message: string;
}

@Injectable({
  providedIn: 'root'
})
export class ImageService {
  private apiUrl = 'http://localhost:3000/api';

  constructor(private http: HttpClient) { }

  // Obtenir toutes les images
  getImages(): Observable<Image[]> {
    return this.http.get<any>(`${this.apiUrl}/images`).pipe(
      map(response => {
        const images = response.images || response || [];
        return images.map((img: any) => this.convertBackendToImage(img));
      }),
      catchError(this.handleError)
    );
  }

  // Obtenir une image par ID
  getImageById(id: string): Observable<Image> {
    return this.http.get<any>(`${this.apiUrl}/images/${id}`).pipe(
      map(img => this.convertBackendToImage(img)),
      catchError(this.handleError)
    );
  }

  // Uploader une image
  uploadImage(file: File): Observable<HttpEvent<any>> {
    const formData = new FormData();
    formData.append('image', file);
    
    const req = new HttpRequest('POST', `${this.apiUrl}/upload`, formData, {
      reportProgress: true,
      responseType: 'json'
    });

    return this.http.request(req).pipe(
      tap((event: HttpEvent<any>) => {
        if (event.type === HttpEventType.UploadProgress && event.total) {
          const progress = Math.round(100 * event.loaded / event.total);
          console.log(`📊 Upload progress: ${progress}%`);
        }
      }),
      catchError(this.handleError)
    );
  }

  // Calculer les descripteurs d'image
  calculateDescriptors(imageId: string): Observable<any> {
    console.log(`🔍 Calcul des descripteurs pour l'image: ${imageId}`);
    
    return this.http.post<any>(`${this.apiUrl}/images/${imageId}/descriptors`, {}).pipe(
      map(response => {
        console.log('✅ Réponse descripteurs:', response);
        return response;
      }),
      catchError(error => {
        console.error('❌ Erreur calcul descripteurs:', error);
        return throwError(() => new Error('Erreur lors du calcul des descripteurs: ' + error.message));
      })
    );
  }

  // Alias pour compatibilité
  calculateImageDescriptors(imageId: string): Observable<any> {
    return this.calculateDescriptors(imageId);
  }

  // Obtenir les statistiques
  getStats(): Observable<any> {
    return this.http.get(`${this.apiUrl}/stats`).pipe(
      catchError(this.handleError)
    );
  }

  // Supprimer une image
  deleteImage(id: string): Observable<any> {
    return this.http.delete(`${this.apiUrl}/images/${id}`).pipe(
      catchError(this.handleError)
    );
  }

  // Conversion helper
  private convertBackendToImage(backendImg: any): Image {
    const id = backendImg._id || backendImg.id || Date.now().toString();
    const name = backendImg.name || backendImg.filename || 'Image sans nom';
    const url = this.getFullImageUrl(backendImg.url || backendImg.path || '');
    
    return {
      id: id,
      name: name,
      url: url,
      uploadDate: new Date(backendImg.uploadDate || backendImg.createdAt || Date.now()),
      descriptors: backendImg.descriptors || null
    };
  }

  // Gestion des erreurs
  private handleError(error: any): Observable<never> {
    let errorMessage = 'Une erreur est survenue';
    
    if (error.error instanceof ErrorEvent) {
      errorMessage = `Erreur: ${error.error.message}`;
    } else if (error.status === 0) {
      errorMessage = 'Impossible de se connecter au serveur. Vérifiez que le backend est démarré.';
    } else if (error.status === 404) {
      errorMessage = 'Ressource non trouvée';
    } else if (error.status === 400) {
      errorMessage = error.error?.message || 'Requête invalide';
    } else if (error.status === 413) {
      errorMessage = 'Fichier trop volumineux';
    } else if (error.status === 415) {
      errorMessage = 'Type de fichier non supporté';
    } else if (error.status === 500) {
      errorMessage = error.error?.message || 'Erreur serveur interne';
    } else if (error.error && error.error.message) {
      errorMessage = error.error.message;
    } else {
      errorMessage = `Code d'erreur: ${error.status}, Message: ${error.message}`;
    }
    
    console.error('ImageService Error:', error);
    return throwError(() => new Error(errorMessage));
  }

  // Méthode utilitaire pour formater la taille de fichier
  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // Méthode utilitaire pour obtenir l'URL complète
  getFullImageUrl(relativeUrl: string): string {
    if (!relativeUrl) return '';
    if (relativeUrl.startsWith('http') || relativeUrl.startsWith('data:')) {
      return relativeUrl;
    }
    return `${this.apiUrl.replace('/api', '')}${relativeUrl}`;
  }
}