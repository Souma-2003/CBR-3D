// src/app/core/services/three-d-search.service.ts
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class ThreeDSearchService {
  private apiUrl = environment.apiUrl; // Plus besoin de .replace()

  constructor(private http: HttpClient) { }

  // Test de connexion au backend 3D
  testConnection(): Observable<any> {
    return this.http.get(`${this.apiUrl}/api/health`).pipe(
      catchError(this.handleError)
    );
  }

  // Recherche 3D avec upload
  search3DModel(file: File, options?: any): Observable<any> {
    const formData = new FormData();
    formData.append('model', file);
    
    if (options) {
      Object.keys(options).forEach(key => {
        if (options[key] !== undefined && options[key] !== null) {
          formData.append(key, options[key].toString());
        }
      });
    }
    
    return this.http.post(`${this.apiUrl}/api/search-3d`, formData).pipe(
      catchError(this.handleError)
    );
  }

  // Recherche à partir d'un modèle existant
  searchByExistingModel(modelId: string, options?: any): Observable<any> {
    const body: any = { model_id: modelId };
    
    if (options) {
      if (options.top_k) body.top_k = options.top_k;
      if (options.filter_by_class !== undefined) body.filter_by_class = options.filter_by_class;
      if (options.weights) body.weights = options.weights;
    }
    
    return this.http.post(`${this.apiUrl}/api/search-3d/existing`, body).pipe(
      catchError(this.handleError)
    );
  }

  // Obtenir les statistiques
  getDatabaseStats(): Observable<any> {
    return this.http.get(`${this.apiUrl}/api/database-stats`).pipe(
      catchError(this.handleError)
    );
  }

  // Obtenir les modèles par classe
  getModelsByClass(): Observable<any> {
    return this.http.get(`${this.apiUrl}/api/models-by-class`).pipe(
      catchError(this.handleError)
    );
  }

  // Obtenir les classes
  getClasses(): Observable<any> {
    return this.http.get(`${this.apiUrl}/api/classes`).pipe(
      catchError(this.handleError)
    );
  }

  // Obtenir les informations d'un modèle
  getModelInfo(modelId: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/api/models/${modelId}`).pipe(
      catchError(this.handleError)
    );
  }

  // Télécharger un modèle
  downloadModel(modelId: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/api/models/${modelId}/file`, {
      responseType: 'blob'
    }).pipe(
      catchError(this.handleError)
    );
  }

  // Indexer les modèles
  indexModels(): Observable<any> {
    return this.http.post(`${this.apiUrl}/api/index-models`, {}).pipe(
      catchError(this.handleError)
    );
  }

  // Optimiser les poids
  optimizeWeights(): Observable<any> {
    return this.http.post(`${this.apiUrl}/api/optimize-weights`, {}).pipe(
      catchError(this.handleError)
    );
  }

  private handleError(error: any): Observable<never> {
    let errorMessage = 'Erreur lors de la recherche 3D';
    
    if (error.status === 0) {
      errorMessage = `Backend non disponible. Vérifiez que le serveur Node.js est démarré sur ${this.apiUrl}`;
    } else if (error.status === 404) {
      errorMessage = 'Endpoint non trouvé. Vérifiez l\'URL de l\'API.';
    } else if (error.error && error.error.message) {
      errorMessage = error.error.message;
    }
    
    console.error('3D Search Error:', error);
    return throwError(() => new Error(errorMessage));
  }
}