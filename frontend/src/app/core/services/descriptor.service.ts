import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class DescriptorService {
  private pythonUrl = environment.pythonServiceUrl;

  constructor(private http: HttpClient) {}

  /**
   * Extraire les descripteurs d'une image
   */
  extractDescriptors(imageFile: File): Observable<any> {
    const formData = new FormData();
    formData.append('image', imageFile);
    
    return this.http.post(`${this.pythonUrl}/extract-descriptors`, formData)
      .pipe(
        catchError(this.handleError)
      );
  }

  /**
   * Obtenir les descripteurs d'une image existante
   */
  getImageDescriptors(imageId: string): Observable<any> {
    return this.http.get(`${this.pythonUrl}/descriptors/${imageId}`)
      .pipe(
        catchError(this.handleError)
      );
  }

  /**
   * Comparer les descripteurs de deux images
   */
  compareDescriptors(imageId1: string, imageId2: string): Observable<any> {
    return this.http.post(`${this.pythonUrl}/compare-descriptors`, {
      image1: imageId1,
      image2: imageId2
    }).pipe(
      catchError(this.handleError)
    );
  }

  /**
   * Rechercher des images similaires
   */
  searchSimilarImages(imageFile: File): Observable<any> {
    const formData = new FormData();
    formData.append('image', imageFile);
    
    return this.http.post(`${this.pythonUrl}/search-similar`, formData)
      .pipe(
        catchError(this.handleError)
      );
  }

  /**
   * Gestion des erreurs
   */
  private handleError(error: HttpErrorResponse) {
    let errorMessage = 'Une erreur est survenue lors de l\'extraction des descripteurs';

    if (error.error instanceof ErrorEvent) {
      errorMessage = error.error.message;
    } else {
      switch (error.status) {
        case 0:
          errorMessage = 'Impossible de se connecter au service de descripteurs.';
          break;
        case 404:
          errorMessage = 'Service de descripteurs non disponible.';
          break;
        case 500:
          errorMessage = 'Erreur interne du service de descripteurs.';
          break;
        default:
          if (error.error?.error) {
            errorMessage = error.error.error;
          }
      }
    }

    console.error('Erreur Descriptor Service:', error);
    return throwError(() => new Error(errorMessage));
  }
}