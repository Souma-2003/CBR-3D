import { Component, OnInit, ViewChild, OnDestroy } from '@angular/core';
import { BackendService } from '../../services/backend.service';
import { Chart } from 'chart.js';
import { Subscription, timer } from 'rxjs';
import { switchMap } from 'rxjs/operators';

@Component({
  selector: 'app-history',
  templateUrl: './history.component.html',
  styleUrls: ['./history.component.css']
})
export class HistoryComponent implements OnInit, OnDestroy {
  @ViewChild('precisionChart', { static: false }) precisionChartRef: any;
  @ViewChild('recallChart', { static: false }) recallChartRef: any;
  @ViewChild('responseTimeChart', { static: false }) responseTimeChartRef: any;
  @ViewChild('classPerformanceChart', { static: false }) classPerformanceChartRef: any;

  // Données de métriques
  performanceMetrics: any = null;
  isLoading = true;
  errorMessage = '';
  today: Date = new Date();
  
  // Métriques globales
  globalMetrics = {
    meanAveragePrecision: 0,
    meanPrecisionAt5: 0,
    meanPrecisionAt10: 0,
    meanRecallAt10: 0,
    avgResponseTime: 0,
    queriesPerSecond: 0,
    totalQueries: 0,
    successRate: 0
  };

  // Graphiques
  charts: any = {};
  
  // Statistiques par classe
  classStatistics: any[] = [];
  
  // Données temporelles
  timeSeriesData: any = null;

  // Informations système
  systemInfo: any = null;

  // Abonnements
  private refreshSubscription?: Subscription;
  private autoRefreshInterval = 30000; // 30 secondes

  // État des graphiques
  private precisionChart: Chart | null = null;
  private recallChart: Chart | null = null;
  private responseTimeChart: Chart | null = null;
  private classPerformanceChart: Chart | null = null;

  constructor(private backendService: BackendService) {}

  ngOnInit(): void {
    this.loadPerformanceMetrics();
    this.startAutoRefresh();
    
    // Mettre à jour l'heure chaque minute
    setInterval(() => {
      this.today = new Date();
    }, 60000);
  }

  ngOnDestroy(): void {
    this.destroyCharts();
    if (this.refreshSubscription) {
      this.refreshSubscription.unsubscribe();
    }
  }

  /**
   * Charger les métriques de performance du CBIR
   */
  loadPerformanceMetrics(): void {
    this.isLoading = true;
    this.errorMessage = '';
    
    this.backendService.getPerformanceMetrics().subscribe({
      next: (response: any) => {
        if (response && response.success) {
          this.performanceMetrics = response.metrics || response;
          this.processMetrics(this.performanceMetrics);
          this.isLoading = false;
        } else {
          this.errorMessage = 'Impossible de charger les métriques de performance';
          this.isLoading = false;
          this.loadDemoMetrics();
        }
      },
      error: (error: any) => {
        console.error('Erreur lors du chargement des métriques:', error);
        this.errorMessage = `Erreur de connexion au serveur: ${error.message}`;
        this.isLoading = false;
        
        // Charger des données de démonstration en cas d'erreur
        this.loadDemoMetrics();
      }
    });
  }

  /**
   * Traiter les métriques reçues
   */
  private processMetrics(metrics: any): void {
    // Détruire les anciens graphiques
    this.destroyCharts();

    // Extraire les métriques globales
    if (metrics.global || metrics) {
      const globalData = metrics.global || metrics;
      this.globalMetrics = {
        meanAveragePrecision: globalData.mean_average_precision || globalData.meanAveragePrecision || 0,
        meanPrecisionAt5: globalData.mean_precision_at_5 || globalData.meanPrecisionAt5 || 0,
        meanPrecisionAt10: globalData.mean_precision_at_10 || globalData.meanPrecisionAt10 || 0,
        meanRecallAt10: globalData.mean_recall_at_10 || globalData.meanRecallAt10 || 0,
        avgResponseTime: globalData.avg_response_time || globalData.avgResponseTime || 0,
        queriesPerSecond: globalData.queries_per_second || globalData.queriesPerSecond || 0,
        totalQueries: globalData.total_queries || globalData.totalQueries || 0,
        successRate: globalData.success_rate || globalData.successRate || 0
      };
    }

    // Extraire les statistiques par classe
    if (metrics.class_performance) {
      this.classStatistics = Object.entries(metrics.class_performance).map(([className, stats]: [string, any]) => ({
        name: className,
        precision: stats.precision || 0,
        recall: stats.recall || 0,
        queriesCount: stats.queries || stats.queriesCount || 0,
        f1Score: this.calculateF1Score(stats.precision || 0, stats.recall || 0)
      }));
    }

    // Extraire les données temporelles
    if (metrics.time_series || metrics.timeSeries) {
      this.timeSeriesData = metrics.time_series || metrics.timeSeries;
    }

    // Extraire les informations système
    if (metrics.system_info || metrics.systemInfo) {
      this.systemInfo = metrics.system_info || metrics.systemInfo;
    }

    // Initialiser les graphiques après un court délai
    setTimeout(() => {
      this.initializeCharts();
    }, 300);
  }

  /**
   * Initialiser les graphiques
   */
  private initializeCharts(): void {
    // 1. Graphique de précision dans le temps
    if (this.timeSeriesData && this.precisionChartRef) {
      this.createPrecisionChart();
    }

    // 2. Graphique de rappel dans le temps
    if (this.timeSeriesData && this.recallChartRef) {
      this.createRecallChart();
    }

    // 3. Graphique des temps de réponse
    if (this.performanceMetrics && this.responseTimeChartRef) {
      this.createResponseTimeChart();
    }

    // 4. Graphique des performances par classe
    if (this.classStatistics.length > 0 && this.classPerformanceChartRef) {
      this.createClassPerformanceChart();
    }
  }

  /**
   * Créer le graphique de précision
   */
  private createPrecisionChart(): void {
    const ctx = this.precisionChartRef.nativeElement.getContext('2d');
    
    this.precisionChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: this.timeSeriesData.dates || ['J-7', 'J-6', 'J-5', 'J-4', 'J-3', 'J-2', 'J-1'],
        datasets: [{
          label: 'Précision moyenne',
          data: this.timeSeriesData.precision || this.timeSeriesData.precisionValues || [0.65, 0.68, 0.70, 0.72, 0.71, 0.73, 0.75],
          borderColor: 'rgb(59, 130, 246)',
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          borderWidth: 2,
          fill: true,
          pointBackgroundColor: 'rgb(59, 130, 246)',
          pointBorderColor: '#fff',
          pointBorderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        legend: {
          display: true,
          position: 'top'
        },
        tooltips: {
          mode: 'index',
          intersect: false
        },
        scales: {
          yAxes: [{
            ticks: {
              beginAtZero: true,
              max: 1,
              callback: (value: any) => {
                return (Number(value) * 100).toFixed(0) + '%';
              }
            }
          }]
        }
      }
    });
  }

  /**
   * Créer le graphique de rappel
   */
  private createRecallChart(): void {
    const ctx = this.recallChartRef.nativeElement.getContext('2d');
    
    this.recallChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: this.timeSeriesData.dates || ['J-7', 'J-6', 'J-5', 'J-4', 'J-3', 'J-2', 'J-1'],
        datasets: [{
          label: 'Rappel moyen',
          data: this.timeSeriesData.recall || this.timeSeriesData.recallValues || [0.58, 0.60, 0.62, 0.63, 0.64, 0.65, 0.66],
          borderColor: 'rgb(16, 185, 129)',
          backgroundColor: 'rgba(16, 185, 129, 0.1)',
          borderWidth: 2,
          fill: true,
          pointBackgroundColor: 'rgb(16, 185, 129)',
          pointBorderColor: '#fff',
          pointBorderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        legend: {
          display: true,
          position: 'top'
        },
        tooltips: {
          mode: 'index',
          intersect: false
        },
        scales: {
          yAxes: [{
            ticks: {
              beginAtZero: true,
              max: 1,
              callback: (value: any) => {
                return (Number(value) * 100).toFixed(0) + '%';
              }
            }
          }]
        }
      }
    });
  }

  /**
   * Créer le graphique des temps de réponse
   */
  private createResponseTimeChart(): void {
    const ctx = this.responseTimeChartRef.nativeElement.getContext('2d');
    
    this.responseTimeChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ['Min', 'Moyenne', 'Max', '95e percentile'],
        datasets: [{
          label: 'Temps de réponse (ms)',
          data: [
            this.performanceMetrics.min_response_time || this.performanceMetrics.minResponseTime || 150,
            this.globalMetrics.avgResponseTime || 450,
            this.performanceMetrics.max_response_time || this.performanceMetrics.maxResponseTime || 1200,
            this.performanceMetrics.p95_response_time || this.performanceMetrics.p95ResponseTime || 850
          ],
          backgroundColor: [
            'rgba(16, 185, 129, 0.7)',
            'rgba(59, 130, 246, 0.7)',
            'rgba(239, 68, 68, 0.7)',
            'rgba(245, 158, 11, 0.7)'
          ]
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        legend: {
          display: false
        },
        scales: {
          yAxes: [{
            ticks: {
              beginAtZero: true
            }
          }]
        }
      }
    });
  }

  /**
   * Créer le graphique des performances par classe
   */
  private createClassPerformanceChart(): void {
    const ctx = this.classPerformanceChartRef.nativeElement.getContext('2d');
    const topClasses = this.classStatistics.slice(0, 8); // Limiter à 8 classes
    
    this.classPerformanceChart = new Chart(ctx, {
      type: 'radar',
      data: {
        labels: topClasses.map(c => c.name),
        datasets: [
          {
            label: 'Précision',
            data: topClasses.map(c => (c.precision || 0) * 100),
            backgroundColor: 'rgba(59, 130, 246, 0.2)',
            borderColor: 'rgb(59, 130, 246)',
            borderWidth: 2,
            pointBackgroundColor: 'rgb(59, 130, 246)',
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
            pointRadius: 3
          },
          {
            label: 'Rappel',
            data: topClasses.map(c => (c.recall || 0) * 100),
            backgroundColor: 'rgba(16, 185, 129, 0.2)',
            borderColor: 'rgb(16, 185, 129)',
            borderWidth: 2,
            pointBackgroundColor: 'rgb(16, 185, 129)',
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
            pointRadius: 3
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scale: {
          ticks: {
            beginAtZero: true,
            max: 100,
            callback: (value: any) => {
              return value + '%';
            }
          }
        }
      }
    });
  }

  /**
   * Détruire tous les graphiques
   */
  private destroyCharts(): void {
    const charts = [
      this.precisionChart,
      this.recallChart,
      this.responseTimeChart,
      this.classPerformanceChart
    ];

    charts.forEach(chart => {
      if (chart) {
        chart.destroy();
      }
    });

    this.precisionChart = null;
    this.recallChart = null;
    this.responseTimeChart = null;
    this.classPerformanceChart = null;
  }

  /**
   * Calculer le score F1
   */
  private calculateF1Score(precision: number, recall: number): number {
    if (precision + recall === 0) return 0;
    return 2 * (precision * recall) / (precision + recall);
  }

  /**
   * Obtenir le score de performance global
   */
  getPerformanceScore(): number {
    const score = (this.globalMetrics.meanAveragePrecision * 100);
    return Math.round(score);
  }

  /**
   * Obtenir le niveau de performance
   */
  getPerformanceLevel(): string {
    const score = this.getPerformanceScore();
    if (score >= 80) return 'Excellent';
    if (score >= 60) return 'Bon';
    if (score >= 40) return 'Moyen';
    return 'À améliorer';
  }

  /**
   * Obtenir la couleur du niveau de performance
   */
  getPerformanceColor(): string {
    const score = this.getPerformanceScore();
    if (score >= 80) return 'text-green-600';
    if (score >= 60) return 'text-blue-600';
    if (score >= 40) return 'text-yellow-600';
    return 'text-red-600';
  }

  /**
   * Obtenir la couleur de fond du niveau de performance
   */
  getPerformanceBgColor(): string {
    const score = this.getPerformanceScore();
    if (score >= 80) return 'bg-green-100';
    if (score >= 60) return 'bg-blue-100';
    if (score >= 40) return 'bg-yellow-100';
    return 'bg-red-100';
  }

  /**
   * Formater un pourcentage
   */
  formatPercentage(value: number): string {
    return (value * 100).toFixed(1) + '%';
  }

  /**
   * Formater un temps en ms
   */
  formatTime(ms: number): string {
    if (ms < 1000) return ms.toFixed(0) + ' ms';
    return (ms / 1000).toFixed(2) + ' s';
  }

  /**
   * Formater un nombre
   */
  formatNumber(num: number): string {
    return num.toLocaleString('fr-FR');
  }

  /**
   * Rafraîchir les métriques
   */
  refreshMetrics(): void {
    this.loadPerformanceMetrics();
  }

  /**
   * Démarrer l'auto-rafraîchissement
   */
  startAutoRefresh(): void {
    this.refreshSubscription = timer(this.autoRefreshInterval, this.autoRefreshInterval)
      .pipe(
        switchMap(() => this.backendService.getPerformanceMetrics())
      )
      .subscribe({
        next: (response: any) => {
          if (response && response.success) {
            this.performanceMetrics = response.metrics || response;
            this.processMetrics(this.performanceMetrics);
          }
        },
        error: (error) => {
          console.error('Erreur lors du rafraîchissement automatique:', error);
        }
      });
  }

  /**
   * Exécuter une évaluation complète
   */
  runFullEvaluation(): void {
    this.isLoading = true;
    this.errorMessage = '';
    
    this.backendService.runEvaluation().subscribe({
      next: (response: any) => {
        if (response && response.success) {
          alert('Évaluation complétée avec succès !');
          this.loadPerformanceMetrics();
        } else {
          this.errorMessage = 'Échec de l\'évaluation';
          this.isLoading = false;
        }
      },
      error: (error: any) => {
        console.error('Erreur lors de l\'évaluation:', error);
        this.errorMessage = `Erreur lors de l'évaluation: ${error.message}`;
        this.isLoading = false;
      }
    });
  }

  /**
   * Charger des données de démonstration
   */
  loadDemoMetrics(): void {
    // Données de démonstration
    this.performanceMetrics = {
      global: {
        mean_average_precision: 0.72,
        mean_precision_at_5: 0.68,
        mean_precision_at_10: 0.65,
        mean_recall_at_10: 0.58,
        avg_response_time: 450,
        queries_per_second: 2.2,
        total_queries: 1250,
        success_rate: 0.92
      },
      class_performance: {
        bottle: { precision: 0.78, recall: 0.72, queries: 180 },
        car: { precision: 0.70, recall: 0.65, queries: 150 },
        person: { precision: 0.65, recall: 0.60, queries: 220 },
        dog: { precision: 0.80, recall: 0.75, queries: 95 },
        cat: { precision: 0.75, recall: 0.70, queries: 85 },
        laptop: { precision: 0.68, recall: 0.62, queries: 120 },
        cup: { precision: 0.72, recall: 0.68, queries: 110 }
      },
      time_series: {
        dates: ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'],
        precision: [0.68, 0.70, 0.71, 0.72, 0.73, 0.74, 0.72],
        recall: [0.56, 0.57, 0.58, 0.59, 0.60, 0.61, 0.58]
      },
      system_info: {
        database_size: "1.2 GB",
        objects_indexed: 12500,
        images_indexed: 2500,
        last_update: "2024-01-07 14:30:00",
        system_status: "Operational"
      }
    };
    
    this.processMetrics(this.performanceMetrics);
    this.isLoading = false;
  }

  /**
   * Exporter les métriques au format CSV
   */
  exportMetrics(): void {
    this.backendService.exportMetrics('csv').subscribe({
      next: (blob: Blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `cbir-metrics-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        window.URL.revokeObjectURL(url);
      },
      error: (error: any) => {
        console.error('Erreur lors de l\'export:', error);
        alert('Erreur lors de l\'export des métriques');
        // Fallback: générer CSV localement
        this.exportMetricsFallback();
      }
    });
  }

  /**
   * Méthode de secours pour l'export CSV
   */
  private exportMetricsFallback(): void {
    const csvContent = this.generateCSV();
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cbir-metrics-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  }

  /**
   * Générer le contenu CSV
   */
  private generateCSV(): string {
    const headers = ['Métrique', 'Valeur', 'Date'];
    const today = new Date().toISOString().split('T')[0];
    const rows = [
      ['mAP (Mean Average Precision)', this.globalMetrics.meanAveragePrecision, today],
      ['Précision@5', this.globalMetrics.meanPrecisionAt5, today],
      ['Précision@10', this.globalMetrics.meanPrecisionAt10, today],
      ['Rappel@10', this.globalMetrics.meanRecallAt10, today],
      ['Temps réponse moyen (ms)', this.globalMetrics.avgResponseTime, today],
      ['Requêtes par seconde', this.globalMetrics.queriesPerSecond, today],
      ['Total requêtes', this.globalMetrics.totalQueries, today],
      ['Taux de succès', this.globalMetrics.successRate, today]
    ];
    
    // Ajouter les performances par classe
    rows.push(['', '', '']);
    rows.push(['Performance par classe', '', '']);
    this.classStatistics.forEach(c => {
      rows.push([`${c.name} - Précision`, c.precision, today]);
      rows.push([`${c.name} - Rappel`, c.recall, today]);
      rows.push([`${c.name} - Score F1`, c.f1Score, today]);
      rows.push([`${c.name} - Nombre de requêtes`, c.queriesCount, today]);
    });
    
    return [headers, ...rows].map(row => 
      row.map(cell => `"${cell}"`).join(',')
    ).join('\n');
  }
}