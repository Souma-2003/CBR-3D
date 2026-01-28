import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map, timeout } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

export interface SearchOptions {
  method: 'cosine' | 'euclidean' | 'manhattan' | 'global';
  limit: number;
  threshold: number;
  class?: string;
}

export interface SearchResponse {
  success: boolean;
  message?: string;
  error?: string;
  data?: {
    results: any[];
    results_by_image?: any[];
    total_similar: number;
    total_images: number;
    threshold: number;
    processing_time: number;
    search_source: string;
    query_type: string;
  };
  query_info?: {
    filename: string;
    class: string;
    confidence: number;
    bbox: any;
    vector_length: number;
  };
  annotated_image?: string;  // Image annotée avec objet sélectionné
  database_info?: {
    total_objects: number;
    total_images: number;
    classes_distribution: any;
    unique_classes: string[];
  };
}

export interface DetectionResponse {
  success: boolean;
  filename: string;
  detections: any[];
  statistics: any;
  processing_time: number;
  annotated_image: string;  // Image annotée avec toutes les détections
}

@Injectable({
  providedIn: 'root'
})
export class DescriptorSearchService {
  private apiUrl = environment.apiUrl || 'http://localhost:3000/api';
  
  constructor(private http: HttpClient) { }

  /**
   * Détecter les objets dans une image (YOLO)
   */
  detectObjects(imageFile: File): Observable<DetectionResponse> {
    const formData = new FormData();
    formData.append('image', imageFile, imageFile.name);
    
    return this.http.post<DetectionResponse>(`${this.apiUrl}/detect`, formData, {
      reportProgress: true,
      observe: 'body'
    }).pipe(
      timeout(60000), // 60 secondes timeout
      catchError(error => {
        console.error('Erreur détection:', error);
        return throwError(() => new Error(
          error.error?.error || error.message || 'Erreur lors de la détection'
        ));
      })
    );
  }

  /**
   * Rechercher des objets similaires (descripteurs pré-calculés)
   * APPROCHE: Envoi de l'image + bbox sélectionnée uniquement
   */
  launchSearch(imageFile: File, bbox: any, options: SearchOptions): Observable<SearchResponse> {
    const formData = new FormData();
    formData.append('image', imageFile, imageFile.name);
    formData.append('bbox', JSON.stringify(bbox));
    formData.append('method', options.method);
    formData.append('threshold', options.threshold.toString());
    formData.append('limit', options.limit.toString());
    
    if (options.class) {
      formData.append('class', options.class);
    }

    console.log('🚀 Lancement recherche avec descripteurs pré-calculés');
    console.log('Options:', options);
    console.log('Bbox:', bbox);

    return this.http.post<SearchResponse>(`${this.apiUrl}/objects/search`, formData, {
      reportProgress: true,
      observe: 'body'
    }).pipe(
      timeout(120000), // 120 secondes timeout
      catchError(error => {
        console.error('Erreur recherche:', error);
        
        // Messages d'erreur spécifiques
        let errorMessage = 'Erreur lors de la recherche';
        if (error.status === 400) {
          errorMessage = 'Bounding box requise. Sélectionnez un objet dans l\'image.';
        } else if (error.status === 503) {
          errorMessage = 'Service indisponible. Vérifiez que le service Python est démarré et la base pré-calculée.';
        } else if (error.error?.error) {
          errorMessage = error.error.error;
        } else if (error.message) {
          errorMessage = error.message;
        }
        
        return throwError(() => new Error(errorMessage));
      })
    );
  }

  /**
   * Rechercher par index de détection existante
   */
  searchByDetection(filename: string, detectionIndex: number, options: SearchOptions): Observable<SearchResponse> {
    return this.http.post<SearchResponse>(`${this.apiUrl}/objects/search-by-detection`, {
      filename,
      detection_index: detectionIndex,
      method: options.method,
      limit: options.limit,
      threshold: options.threshold
    }).pipe(
      timeout(120000),
      catchError(error => {
        console.error('Erreur recherche par détection:', error);
        return throwError(() => new Error(
          error.error?.error || error.message || 'Erreur lors de la recherche'
        ));
      })
    );
  }

  /**
   * Obtenir les informations sur la base de données
   */
  getDatabaseInfo(): Observable<any> {
    return this.http.get(`${this.apiUrl}/database/info`).pipe(
      catchError(error => {
        console.error('Erreur info base:', error);
        return throwError(() => new Error(
          error.error?.error || error.message || 'Impossible de récupérer les infos de la base'
        ));
      })
    );
  }

  /**
   * Vérifier l'état du système
   */
  getSystemStatus(): Observable<any> {
    return this.http.get(`${this.apiUrl}/system/status`).pipe(
      catchError(error => {
        console.error('Erreur statut système:', error);
        return throwError(() => new Error(
          error.error?.error || error.message || 'Impossible de vérifier l\'état du système'
        ));
      })
    );
  }

  /**
   * Obtenir la liste des classes disponibles
   */
  getAvailableClasses(): Observable<{success: boolean, classes: string[]}> {
    return this.http.get<{success: boolean, classes: string[]}>(`${this.apiUrl}/classes`).pipe(
      catchError(error => {
        console.error('Erreur classes:', error);
        // Fallback aux classes par défaut
        const defaultClasses = [
          "bottle", "car", "bus", "bicycle", "motorcycle",
          "person", "dog", "horse", "cow", "elephant",
          "bird", "apple", "banana", "cup", "laptop"
        ];
        return throwError(() => new Error('Impossible de récupérer les classes'));
      })
    );
  }

  /**
   * Obtenir les statistiques du système
   */
  getStats(): Observable<any> {
    return this.http.get(`${this.apiUrl}/stats`).pipe(
      catchError(error => {
        console.error('Erreur stats:', error);
        return throwError(() => new Error(
          error.error?.error || error.message || 'Impossible de récupérer les statistiques'
        ));
      })
    );
  }
}