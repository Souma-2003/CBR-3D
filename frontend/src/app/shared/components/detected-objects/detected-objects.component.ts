import { Component, Input, Output, EventEmitter } from '@angular/core';

@Component({
  selector: 'app-detected-objects',
  template: `
    <div class="detected-objects-container">
      <h3 *ngIf="title">{{ title }}</h3>
      
      <div class="objects-grid">
        <div *ngFor="let obj of objects" 
             class="object-item"
             [class.selected]="selectedObjectId === obj._id"
             (click)="selectObject(obj)">
          
          <div class="object-header">
            <span class="object-class">{{ obj.class_name }}</span>
            <span class="object-confidence">{{ obj.confidence | percent:'1.0-1' }}</span>
          </div>
          
          <div class="object-details">
            <div class="bbox-info">
              <small>
                Pos: ({{ obj.bbox.x1 | number:'1.0-0' }}, {{ obj.bbox.y1 | number:'1.0-0' }})<br>
                Size: {{ obj.bbox.width | number:'1.0-0' }}×{{ obj.bbox.height | number:'1.0-0' }}
              </small>
            </div>
          </div>
          
          <div class="object-actions">
            <button class="btn-view" (click)="viewObject(obj); $event.stopPropagation()">
              👁️ Voir
            </button>
            <button class="btn-search" (click)="searchObject(obj); $event.stopPropagation()">
              🔍 Rechercher
            </button>
          </div>
        </div>
      </div>
    </div>
  `,
  styleUrls: ['./detected-objects.component.css']
})
export class DetectedObjectsComponent {
  @Input() objects: any[] = [];
  @Input() title: string = 'Objets Détectés';
  @Input() selectedObjectId: string = '';
  
  @Output() objectSelected = new EventEmitter<any>();
  @Output() objectViewed = new EventEmitter<any>();
  @Output() objectSearched = new EventEmitter<any>();
  
  selectObject(obj: any): void {
    this.selectedObjectId = obj._id;
    this.objectSelected.emit(obj);
  }
  
  viewObject(obj: any): void {
    this.objectViewed.emit(obj);
  }
  
  searchObject(obj: any): void {
    this.objectSearched.emit(obj);
  }
}