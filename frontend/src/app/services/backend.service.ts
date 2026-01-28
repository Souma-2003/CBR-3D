import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';

@Injectable({
  providedIn: 'root'
})
export class BackendService {
  private backendUrl = 'http://localhost:3000';
  private pythonServiceUrl = 'http://localhost:5000';

  constructor(private http: HttpClient) {}

  // ==============================
  // MÉTHODES DE SANTÉ ET SYSTÈME
  // ==============================

  /**
   * Vérifier la santé du système complet
   */
  checkSystemHealth(): Observable<any> {
    return this.http.get(`${this.backendUrl}/health`)
      .pipe(
        catchError(this.handleError)
      );
  }

  /**
   * Version asynchrone pour checkSystemHealth
   */
  async checkSystemHealthAsync(): Promise<any> {
    try {
      const response = await fetch(`${this.backendUrl}/health`);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      return await response.json();
    } catch (error: any) {
      console.error('Health check failed:', error);
      return { success: false, error: error.message };
    }
  }

  // ==============================
  // MÉTHODES POUR LA RECHERCHE 3D
  // ==============================

  /**
   * Rechercher des modèles 3D similaires (upload d'un fichier .obj)
   */
  search3dModels(file: File, topK: number = 12, filterByClass: boolean = true, weights: any = null): Observable<any> {
    const formData = new FormData();
    formData.append('model', file);
    formData.append('top_k', topK.toString());
    formData.append('filter_by_class', filterByClass.toString());
    
    if (weights) {
      formData.append('weights', JSON.stringify(weights));
    }
    
    return this.http.post(`${this.backendUrl}/search-3d`, formData)
      .pipe(
        catchError(this.handleError)
      );
  }

  /**
   * Rechercher des modèles 3D similaires à partir d'un modèle existant
   */
  search3dFromExisting(modelId: string, topK: number = 12, filterByClass: boolean = true, weights: any = null): Observable<any> {
    const data = {
      model_id: modelId,
      top_k: topK,
      filter_by_class: filterByClass,
      weights: weights
    };
    
    return this.http.post(`${this.backendUrl}/search-3d/existing`, data)
      .pipe(
        catchError(this.handleError)
      );
  }

  /**
   * Version asynchrone pour search3dModels
   */
  async search3dModelsAsync(file: File, topK: number = 12, filterByClass: boolean = true): Promise<any> {
    const formData = new FormData();
    formData.append('model', file);
    formData.append('top_k', topK.toString());
    formData.append('filter_by_class', filterByClass.toString());
    
    try {
      const response = await fetch(`${this.backendUrl}/search-3d`, {
        method: 'POST',
        body: formData
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      return await response.json();
    } catch (error: any) {
      console.error('Search 3D failed:', error);
      throw error;
    }
  }

  // ==============================
  // MÉTHODES POUR LA BASE DE DONNÉES 3D
  // ==============================

  /**
   * Obtenir les statistiques de la base de données
   */
  getDatabaseStats(): Observable<any> {
    return this.http.get(`${this.backendUrl}/database-stats`)
      .pipe(
        catchError(this.handleError)
      );
  }

  /**
   * Obtenir la liste des modèles organisés par classe
   */
  getModelsByClass(): Observable<any> {
    return this.http.get(`${this.backendUrl}/models-by-class`)
      .pipe(
        catchError(this.handleError)
      );
  }

  /**
   * Obtenir la liste des classes disponibles
   */
  getClasses(): Observable<any> {
    return this.http.get(`${this.backendUrl}/classes`)
      .pipe(
        catchError(this.handleError)
      );
  }

  /**
   * Obtenir les informations d'un modèle spécifique
   */
  getModel(modelId: string): Observable<any> {
    return this.http.get(`${this.backendUrl}/models/${modelId}`)
      .pipe(
        catchError(this.handleError)
      );
  }

  /**
   * Télécharger un fichier modèle .obj
   */
  downloadModel(modelId: string): Observable<Blob> {
    return this.http.get(`${this.backendUrl}/models/${modelId}/file`, {
      responseType: 'blob'
    })
      .pipe(
        catchError(this.handleError)
      );
  }

  /**
   * Indexer les modèles dans la base de données (lancer le calcul des descripteurs)
   */
  indexModels(): Observable<any> {
    return this.http.post(`${this.backendUrl}/index-models`, {})
      .pipe(
        catchError(this.handleError)
      );
  }

  /**
   * Optimiser les poids de similarité
   */
  optimizeWeights(): Observable<any> {
    return this.http.post(`${this.backendUrl}/optimize-weights`, {})
      .pipe(
        catchError(this.handleError)
      );
  }

  // ==============================
  // MÉTHODES POUR LES MÉTRIQUES ET ANALYTICS
  // ==============================

  /**
   * Obtenir les métriques de performance du système (si service Python disponible)
   */
  getPerformanceMetrics(): Observable<any> {
    return this.http.get(`${this.pythonServiceUrl}/api/dashboard`)
      .pipe(
        catchError(this.handleMetricsError)
      );
  }

  /**
   * Exporter les métriques dans un format spécifique
   */
  exportMetrics(format: string = 'csv'): Observable<any> {
    const headers = new HttpHeaders({
      'Accept': 'application/octet-stream'
    });
    
    return this.http.get(`${this.pythonServiceUrl}/api/export-metrics?format=${format}`, {
      headers: headers,
      responseType: 'blob'
    }).pipe(
      catchError(this.handleMetricsError)
    );
  }

  /**
   * Exécuter une évaluation complète du système
   */
  runEvaluation(): Observable<any> {
    return this.http.post(`${this.pythonServiceUrl}/api/evaluate`, {})
      .pipe(
        catchError(this.handleMetricsError)
      );
  }

  /**
   * Obtenir les statistiques par classe
   */
  getClassStatistics(): Observable<any> {
    return this.http.get(`${this.pythonServiceUrl}/api/class-statistics`)
      .pipe(
        catchError(this.handleMetricsError)
      );
  }

  /**
   * Vérifier la santé du service Python (si disponible)
   */
  checkPythonHealth(): Observable<any> {
    return this.http.get(`${this.pythonServiceUrl}/health`)
      .pipe(
        catchError(this.handleMetricsError)
      );
  }

  /**
   * Obtenir les informations système du service Python
   */
  getPythonSystemInfo(): Observable<any> {
    return this.http.get(`${this.pythonServiceUrl}/api/system-info`)
      .pipe(
        catchError(this.handleMetricsError)
      );
  }

  /**
   * Obtenir les statistiques de la base de données MongoDB
   */
  getDatabaseStatistics(): Observable<any> {
    return this.http.get(`${this.pythonServiceUrl}/api/database-info`)
      .pipe(
        catchError(this.handleMetricsError)
      );
  }

  /**
   * Obtenir les performances de recherche par type
   */
  getSearchPerformance(): Observable<any> {
    return this.http.get(`${this.pythonServiceUrl}/api/search-performance`)
      .pipe(
        catchError(this.handleMetricsError)
      );
  }

  /**
   * Obtenir les métriques en temps réel
   */
  getRealtimeMetrics(): Observable<any> {
    return this.http.get(`${this.pythonServiceUrl}/api/realtime-metrics`)
      .pipe(
        catchError(this.handleMetricsError)
      );
  }

  /**
   * Obtenir l'historique des métriques sur une période
   */
  getMetricsHistory(days: number = 7): Observable<any> {
    return this.http.get(`${this.pythonServiceUrl}/api/metrics-history?days=${days}`)
      .pipe(
        catchError(this.handleMetricsError)
      );
  }

  // ==============================
  // MÉTHODES POUR LA DÉTECTION D'IMAGES (YOLO)
  // ==============================

  /**
   * Détecter des objets dans une image (YOLO)
   */
  detectObjects(imageFile: File, options: any = {}): Observable<any> {
    const formData = new FormData();
    formData.append('image', imageFile);
    formData.append('conf', options.confidence?.toString() || '0.25');
    formData.append('iou', options.iou?.toString() || '0.45');
    
    return this.http.post(`${this.backendUrl}/detect`, formData)
      .pipe(
        catchError(this.handleError)
      );
  }

  /**
   * Uploader une image (sans détection)
   */
  uploadImage(file: File): Observable<any> {
    const formData = new FormData();
    formData.append('image', file);
    
    return this.http.post(`${this.backendUrl}/upload`, formData)
      .pipe(
        catchError(this.handleError)
      );
  }

  /**
   * Obtenir toutes les images uploadées
   */
  getImages(): Observable<any> {
    return this.http.get(`${this.backendUrl}/images`)
      .pipe(
        catchError(this.handleError)
      );
  }

  /**
   * Obtenir toutes les détections
   */
  getDetections(): Observable<any> {
    return this.http.get(`${this.backendUrl}/detections`)
      .pipe(
        catchError(this.handleError)
      );
  }

  /**
   * Obtenir les détections d'une image spécifique
   */
  getImageDetections(filename: string): Observable<any> {
    return this.http.get(`${this.backendUrl}/detections/${filename}`)
      .pipe(
        catchError(this.handleError)
      );
  }

  /**
   * Obtenir les détections par classe
   */
  getDetectionsByClass(className: string): Observable<any> {
    return this.http.get(`${this.backendUrl}/detections/class/${className}`)
      .pipe(
        catchError(this.handleError)
      );
  }

  // ==============================
  // MÉTHODES ASYNCHRONES POUR LES IMAGES
  // ==============================

  /**
   * Version asynchrone pour detectObjects
   */
  async detectObjectsAsync(imageFile: File, options: any = {}): Promise<any> {
    const formData = new FormData();
    formData.append('image', imageFile);
    formData.append('conf', options.confidence?.toString() || '0.25');
    formData.append('iou', options.iou?.toString() || '0.45');
    
    try {
      const response = await fetch(`${this.backendUrl}/detect`, {
        method: 'POST',
        body: formData
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      return await response.json();
    } catch (error: any) {
      console.error('Detection failed:', error);
      throw error;
    }
  }

  /**
   * Version asynchrone pour uploadImage
   */
  async uploadImageAsync(file: File): Promise<any> {
    const formData = new FormData();
    formData.append('image', file);
    
    try {
      const response = await fetch(`${this.backendUrl}/upload`, {
        method: 'POST',
        body: formData
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      return await response.json();
    } catch (error: any) {
      console.error('Upload failed:', error);
      throw error;
    }
  }

  // ==============================
  // MÉTHODES UTILITAIRES
  // ==============================

  /**
   * Obtenir les statistiques globales
   */
  getStats(): Observable<any> {
    return this.http.get(`${this.backendUrl}/stats`)
      .pipe(
        catchError(this.handleError)
      );
  }

  /**
   * Télécharger un fichier
   */
  downloadFile(url: string): Observable<Blob> {
    return this.http.get(url, { responseType: 'blob' })
      .pipe(
        catchError(this.handleError)
      );
  }

  /**
   * Sauvegarder des données
   */
  saveData(data: any, endpoint: string): Observable<any> {
    return this.http.post(`${this.backendUrl}/${endpoint}`, data)
      .pipe(
        catchError(this.handleError)
      );
  }

  /**
   * Mettre à jour des données
   */
  updateData(id: string, data: any, endpoint: string): Observable<any> {
    return this.http.put(`${this.backendUrl}/${endpoint}/${id}`, data)
      .pipe(
        catchError(this.handleError)
      );
  }

  /**
   * Supprimer des données
   */
  deleteData(id: string, endpoint: string): Observable<any> {
    return this.http.delete(`${this.backendUrl}/${endpoint}/${id}`)
      .pipe(
        catchError(this.handleError)
      );
  }

  // ==============================
  // MÉTHODES DE GESTION DES ERREURS
  // ==============================

  /**
   * Gestion d'erreur principale
   */
  private handleError(error: any): Observable<never> {
    let errorMessage = 'Une erreur est survenue';
    
    if (error.error instanceof ErrorEvent) {
      // Erreur côté client
      errorMessage = `Erreur: ${error.error.message}`;
    } else if (error.status === 0) {
      // Pas de connexion au serveur
      errorMessage = 'Impossible de se connecter au serveur. Vérifiez que le backend Node.js est en cours d\'exécution sur http://localhost:3000';
    } else if (error.status === 404) {
      // Ressource non trouvée
      errorMessage = 'Endpoint non trouvé. Vérifiez l\'URL de l\'API.';
    } else if (error.status === 500) {
      // Erreur serveur
      errorMessage = 'Erreur serveur interne';
    } else if (error.error && error.error.message) {
      // Message d'erreur du serveur
      errorMessage = error.error.message;
    } else {
      // Autre erreur
      errorMessage = `Code d'erreur: ${error.status}, Message: ${error.message}`;
    }
    
    console.error('BackendService Error:', error);
    return throwError(() => new Error(errorMessage));
  }

  /**
   * Gestion d'erreur spécifique pour les métriques Python
   */
  private handleMetricsError(error: any): Observable<never> {
    let errorMessage = 'Erreur lors de la communication avec le service Python';
    
    if (error.error instanceof ErrorEvent) {
      errorMessage = `Erreur: ${error.error.message}`;
    } else if (error.status === 0) {
      errorMessage = 'Service Python non disponible. Vérifiez que le serveur Flask est en cours d\'exécution sur le port 5000.';
    } else if (error.status === 404) {
      errorMessage = 'Endpoint des métriques non trouvé';
    } else if (error.status === 500) {
      errorMessage = 'Erreur interne du serveur Python';
    } else if (error.error && error.error.message) {
      errorMessage = error.error.message;
    } else {
      errorMessage = `Erreur ${error.status}: ${error.message}`;
    }
    
    console.error('Metrics Service Error:', error);
    return throwError(() => new Error(errorMessage));
  }

  /**
   * Méthode utilitaire pour créer des headers HTTP
   */
  private getHeaders(): HttpHeaders {
    return new HttpHeaders({
      'Accept': 'application/json',
      'Cache-Control': 'no-cache'
    });
  }

  /**
   * Méthode utilitaire pour créer des headers avec authentification
   */
  private getAuthHeaders(): HttpHeaders {
    const token = localStorage.getItem('auth_token');
    return new HttpHeaders({
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`,
      'Cache-Control': 'no-cache'
    });
  }

  // ==============================
  // MÉTHODES POUR LA RECHERCHE CBIR D'IMAGES
  // ==============================

  /**
   * Rechercher des images similaires (CBIR) - si service Python disponible
   */
  searchSimilarImages(formData: FormData): Observable<any> {
    return this.http.post(`${this.pythonServiceUrl}/api/search-objects`, formData)
      .pipe(
        catchError(this.handleMetricsError)
      );
  }

  /**
   * Extraire les descripteurs d'une image - si service Python disponible
   */
  extractImageDescriptors(formData: FormData): Observable<any> {
    return this.http.post(`${this.pythonServiceUrl}/api/extract-image-descriptors`, formData)
      .pipe(
        catchError(this.handleMetricsError)
      );
  }

  /**
   * Comparer deux objets
   */
  compareObjects(obj1: any, obj2: any): Observable<any> {
    return this.http.post(`${this.pythonServiceUrl}/api/compare-objects`, { obj1, obj2 })
      .pipe(
        catchError(this.handleMetricsError)
      );
  }

  // ==============================
  // MÉTHODES POUR LES TESTS DE PERFORMANCE
  // ==============================

  /**
   * Exécuter un test de performance - si service Python disponible
   */
  runPerformanceTest(testConfig: any): Observable<any> {
    return this.http.post(`${this.pythonServiceUrl}/api/performance-test`, testConfig)
      .pipe(
        catchError(this.handleMetricsError)
      );
  }

  /**
   * Obtenir les résultats des tests de performance - si service Python disponible
   */
  getPerformanceTestResults(): Observable<any> {
    return this.http.get(`${this.pythonServiceUrl}/api/performance-test-results`)
      .pipe(
        catchError(this.handleMetricsError)
      );
  }

  // ==============================
  // MÉTHODES POUR LES LOGS ET MONITORING
  // ==============================

  /**
   * Obtenir les logs système - si service Python disponible
   */
  getSystemLogs(): Observable<any> {
    return this.http.get(`${this.pythonServiceUrl}/api/system-logs`)
      .pipe(
        catchError(this.handleMetricsError)
      );
  }

  // ==============================
  // MÉTHODES POUR L'AUTHENTIFICATION (optionnel)
  // ==============================

  /**
   * Authentifier un utilisateur
   */
  login(credentials: { username: string, password: string }): Observable<any> {
    return this.http.post(`${this.backendUrl}/auth/login`, credentials)
      .pipe(
        catchError(this.handleError)
      );
  }

  /**
   * Déconnexion
   */
  logout(): Observable<any> {
    return this.http.post(`${this.backendUrl}/auth/logout`, {})
      .pipe(
        catchError(this.handleError)
      );
  }

  /**
   * Vérifier le token d'authentification
   */
  checkAuth(): Observable<any> {
    return this.http.get(`${this.backendUrl}/auth/check`)
      .pipe(
        catchError(this.handleError)
      );
  }

  // ==============================
  // MÉTHODES DE DIAGNOSTIC ET DÉBOGAGE
  // ==============================

  /**
   * Tester la connexion au backend
   */
  testBackendConnection(): Promise<boolean> {
    return new Promise((resolve) => {
      this.checkSystemHealth().subscribe({
        next: () => resolve(true),
        error: () => resolve(false)
      });
    });
  }

  /**
   * Tester la connexion au service Python
   */
  testPythonConnection(): Promise<boolean> {
    return new Promise((resolve) => {
      this.checkPythonHealth().subscribe({
        next: () => resolve(true),
        error: () => resolve(false)
      });
    });
  }

  /**
   * Obtenir l'état complet du système
   */
  async getSystemStatus(): Promise<any> {
    const backendStatus = await this.testBackendConnection();
    const pythonStatus = await this.testPythonConnection();
    
    return {
      backend: {
        available: backendStatus,
        url: this.backendUrl
      },
      python_service: {
        available: pythonStatus,
        url: this.pythonServiceUrl
      },
      timestamp: new Date().toISOString()
    };
  }

  // ==============================
  // MÉTHODES SPÉCIFIQUES POUR L'INTERFACE UTILISATEUR
  // ==============================

  /**
   * Formater les résultats de recherche 3D pour l'affichage
   */
  format3dSearchResults(results: any): any[] {
    if (!results || !results.results) return [];
    
    return results.results.map((item: any, index: number) => ({
      id: index + 1,
      modelId: item.model_id,
      name: item.name || item.model_id,
      similarity: item.similarity || 0,
      percentage: Math.round((item.similarity || 0) * 100),
      class: item.class || 'Unknown',
      fileExists: item.file_exists || false,
      thumbnail: item.thumbnail || this.generatePlaceholderImage(item.model_id),
      filePath: item.file_path,
      metadata: item.metadata || {}
    }));
  }

  /**
   * Générer une image placeholder pour un modèle
   */
  private generatePlaceholderImage(modelId: string): string {
    // Créer une image de placeholder basée sur le modelId
    const colors = ['3498db', 'e74c3c', '2ecc71', 'f39c12', '9b59b6'];
    const color = colors[modelId.length % colors.length];
    const text = modelId.substring(0, 3).toUpperCase();
    
    return `https://via.placeholder.com/300x200/${color}/ffffff?text=${text}`;
  }

  /**
   * Trier les résultats par similarité
   */
  sortResultsBySimilarity(results: any[]): any[] {
    return results.sort((a, b) => b.similarity - a.similarity);
  }

  /**
   * Filtrer les résultats par classe
   */
  filterResultsByClass(results: any[], className: string): any[] {
    if (!className || className === 'all') return results;
    return results.filter(item => item.class === className);
  }

  // ==============================
  // MÉTHODES POUR LE TÉLÉCHARGEMENT DE FICHIERS
  // ==============================

  /**
   * Télécharger un modèle 3D
   */
  download3dModel(modelId: string, filename: string): void {
    this.downloadModel(modelId).subscribe({
      next: (blob: Blob) => {
        // Créer un lien de téléchargement
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename || `${modelId}.obj`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      },
      error: (error) => {
        console.error('Erreur lors du téléchargement:', error);
      }
    });
  }

  /**
   * Exporter les résultats au format CSV (côté client)
   */
  exportResultsToCsv(results: any[], filename: string = 'search-results.csv'): void {
    if (!results || results.length === 0) return;
    
    const headers = ['ID', 'Model ID', 'Name', 'Similarity (%)', 'Class', 'File Exists'];
    const csvRows = results.map(item => [
      item.id,
      item.modelId,
      item.name,
      item.percentage,
      item.class,
      item.fileExists
    ]);
    
    const csvContent = [
      headers.join(','),
      ...csvRows.map(row => row.join(','))
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }

  /**
   * Version HttpClient pour getPerformanceMetrics
   */
  getPerformanceMetricsHttpClient(): Observable<any> {
    return this.http.get(`${this.pythonServiceUrl}/api/dashboard`)
      .pipe(
        catchError(this.handleMetricsError)
      );
  }

  /**
   * Version HttpClient pour runEvaluation
   */
  runEvaluationHttpClient(): Observable<any> {
    return this.http.post(`${this.pythonServiceUrl}/api/evaluate`, {})
      .pipe(
        catchError(this.handleMetricsError)
      );
  }

  /**
   * Version HttpClient pour getClassStatistics
   */
  getClassStatisticsHttpClient(): Observable<any> {
    return this.http.get(`${this.pythonServiceUrl}/api/class-statistics`)
      .pipe(
        catchError(this.handleMetricsError)
      );
  }

  /**
   * Version HttpClient pour searchSimilarImages
   */
  searchSimilarImagesHttpClient(formData: FormData): Observable<any> {
    return this.http.post(`${this.pythonServiceUrl}/api/search-objects`, formData)
      .pipe(
        catchError(this.handleMetricsError)
      );
  }

  /**
   * Version HttpClient pour getImages
   */
  getImagesHttpClient(): Observable<any> {
    return this.http.get(`${this.backendUrl}/images`)
      .pipe(
        catchError(this.handleError)
      );
  }

  /**
   * Version HttpClient pour checkHealth
   */
  checkHealthHttpClient(): Observable<any> {
    return this.http.get(`${this.backendUrl}/health`)
      .pipe(
        catchError(this.handleError)
      );
  }

  /**
   * Version HttpClient pour uploadImage
   */
  uploadImageHttpClient(file: File): Observable<any> {
    const formData = new FormData();
    formData.append('image', file);

    return this.http.post(`${this.backendUrl}/upload`, formData)
      .pipe(
        catchError(this.handleError)
      );
  }

  /**
   * Version HttpClient pour detectObjects
   */
  detectObjectsHttpClient(imageFile: File, options: any = {}): Observable<any> {
    const formData = new FormData();
    formData.append('image', imageFile);
    formData.append('conf', options.confidence?.toString() || '0.25');
    formData.append('iou', options.iou?.toString() || '0.45');

    return this.http.post(`${this.backendUrl}/detect`, formData)
      .pipe(
        catchError(this.handleError)
      );
  }

  /**
   * Version HttpClient pour getYoloClasses
   */
  getYoloClassesHttpClient(): Observable<any> {
    return this.http.get(`${this.pythonServiceUrl}/classes`)
      .pipe(
        catchError(this.handleMetricsError)
      );
  }

  /**
   * Version asynchrone pour getPerformanceMetrics
   */
  async getPerformanceMetricsAsync(): Promise<any> {
    try {
      const response = await fetch(`${this.pythonServiceUrl}/api/dashboard`);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      return await response.json();
    } catch (error: any) {
      console.error('Get performance metrics failed:', error);
      throw error;
    }
  }

  /**
   * Version asynchrone pour runEvaluation
   */
  async runEvaluationAsync(): Promise<any> {
    try {
      const response = await fetch(`${this.pythonServiceUrl}/api/evaluate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      return await response.json();
    } catch (error: any) {
      console.error('Run evaluation failed:', error);
      throw error;
    }
  }

  /**
   * Version asynchrone pour getClassStatistics
   */
  async getClassStatisticsAsync(): Promise<any> {
    try {
      const response = await fetch(`${this.pythonServiceUrl}/api/class-statistics`);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      return await response.json();
    } catch (error: any) {
      console.error('Get class statistics failed:', error);
      throw error;
    }
  }

  /**
   * Obtenir les classes YOLO depuis le service Python
   */
  async getYoloClasses(): Promise<any> {
    try {
      const response = await fetch(`${this.pythonServiceUrl}/classes`);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      return await response.json();
    } catch (error: any) {
      console.error('Get classes failed:', error);
      throw error;
    }
  }

  /**
   * Vérifier la santé du service Python
   */
  async checkYoloHealth(): Promise<any> {
    try {
      const response = await fetch(`${this.pythonServiceUrl}/health`);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      return await response.json();
    } catch (error: any) {
      console.error('Yolo health check failed:', error);
      throw error;
    }
  }
}