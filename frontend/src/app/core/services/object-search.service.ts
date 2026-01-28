import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';

@Injectable({
  providedIn: 'root'
})
export class ObjectSearchService {
  private apiUrl = 'http://localhost:3000/api';

  constructor(private http: HttpClient) { }

  // Rechercher des images similaires par objet
  searchByObject(objectId: string, limit: number = 10): Observable<any> {
    return this.http.post(`${this.apiUrl}/search/object`, {
      objectId,
      limit
    }).pipe(
      catchError(this.handleError)
    );
  }

  // Rechercher par classe d'objet
  searchByObjectClass(className: string, limit: number = 10): Observable<any> {
    return this.http.post(`${this.apiUrl}/search/object`, {
      class_name: className,
      limit
    }).pipe(
      catchError(this.handleError)
    );
  }

  // Obtenir toutes les classes d'objets disponibles
  getAvailableClasses(): Observable<any> {
    return this.http.get(`${this.apiUrl}/search/objects/classes`)
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
      errorMessage = 'Impossible de se connecter au serveur. Vérifiez votre connexion.';
    } else if (error.status === 404) {
      errorMessage = 'Ressource non trouvée';
    } else if (error.status === 500) {
      errorMessage = 'Erreur serveur interne';
    } else if (error.error && error.error.message) {
      errorMessage = error.error.message;
    } else {
      errorMessage = `Code d'erreur: ${error.status}, Message: ${error.message}`;
    }
    
    console.error('ObjectSearchService Error:', error);
    return throwError(() => new Error(errorMessage));
  }
}