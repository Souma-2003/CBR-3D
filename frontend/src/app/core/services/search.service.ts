import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class SearchService {
   private apiUrl = environment.apiUrl; 

  constructor(private http: HttpClient) { }

  // Recherche par descripteurs (nouvelle méthode)
  launchSearch(
    imageFile?: File,
    imageId?: string,
    bbox?: any,
    options?: {
      method?: string;
      limit?: number;
      threshold?: number;
    }
  ): Observable<any> {
    const formData = new FormData();
    
    if (imageFile) {
      formData.append('image', imageFile);
    }
    
    if (imageId) {
      formData.append('imageId', imageId);
    }
    
    if (bbox) {
      formData.append('bbox', JSON.stringify(bbox));
    }
    
    if (options) {
      formData.append('method', options.method || 'cosine');
      formData.append('limit', (options.limit || 10).toString());
      formData.append('threshold', (options.threshold || 0.5).toString());
    }

    return this.http.post(`${this.apiUrl}/search/launch`, formData)
      .pipe(
        catchError(this.handleError)
      );
  }

  // Recherche par détection YOLO
  searchByYoloDetection(
    imageId: string,
    detectionIndex: number,
    options?: {
      method?: string;
      limit?: number;
      threshold?: number;
    }
  ): Observable<any> {
    const body = {
      image_id: imageId,
      detection_index: detectionIndex,
      ...options
    };

    return this.http.post(`${this.apiUrl}/search/by-yolo-detection`, body)
      .pipe(
        catchError(this.handleError)
      );
  }

  // Calculer tous les descripteurs
  computeAllDescriptors(): Observable<any> {
    return this.http.post(`${this.apiUrl}/search/compute-descriptors`, {})
      .pipe(
        catchError(this.handleError)
      );
  }

  // Obtenir l'historique des recherches
  getSearchHistory(page: number = 1, limit: number = 20): Observable<any> {
    const params = new HttpParams()
      .set('page', page.toString())
      .set('limit', limit.toString());

    return this.http.get(`${this.apiUrl}/search/history`, { params })
      .pipe(
        catchError(this.handleError)
      );
  }

  // Obtenir les détails d'une recherche
  getSearchDetails(searchId: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/search/history/${searchId}`)
      .pipe(
        catchError(this.handleError)
      );
  }

  // Obtenir les images de test
  getTestImages(): Observable<any> {
    return this.http.get(`${this.apiUrl}/images/test`)
      .pipe(
        catchError(this.handleError)
      );
  }

  // Rechercher des images similaires (ancienne méthode)
  searchSimilar(imageFile: File): Observable<any> {
    const formData = new FormData();
    formData.append('image', imageFile);

    return this.http.post(`${this.apiUrl}/search/similar`, formData)
      .pipe(
        catchError(this.handleError)
      );
  }

  // Recherche avancée
  advancedSearch(criteria: any): Observable<any> {
    return this.http.post(`${this.apiUrl}/search/advanced`, criteria)
      .pipe(
        catchError(this.handleError)
      );
  }

  // Gestion des erreurs
  private handleError(error: any): Observable<never> {
    let errorMessage = 'Une erreur est survenue';
    
    if (error.error instanceof ErrorEvent) {
      errorMessage = `Erreur: ${error.error.message}`;
    } else if (error.status === 0) {
      errorMessage = 'Impossible de se connecter au serveur';
    } else if (error.status === 404) {
      errorMessage = 'Service non trouvé';
    } else if (error.status === 500) {
      errorMessage = 'Erreur serveur';
    } else if (error.error && error.error.message) {
      errorMessage = error.error.message;
    } else {
      errorMessage = `Code d'erreur: ${error.status}, Message: ${error.message}`;
    }
    
    console.error('SearchService Error:', error);
    return throwError(() => new Error(errorMessage));
  }
}