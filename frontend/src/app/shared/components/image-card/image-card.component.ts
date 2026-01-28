import { Component, Input, Output, EventEmitter } from '@angular/core';

export interface Image {
  id: string;
  filename: string;
  url: string;
  uploadDate: string;
  size: number;
  metadata?: {
    width: number;
    height: number;
    format: string;
  };
}

@Component({
  selector: 'app-image-card',
  templateUrl: './image-card.component.html',
  styleUrls: ['./image-card.component.css']
})
export class ImageCardComponent {
  @Input() image!: Image;
  @Input() showActions: boolean = true;
  @Input() similarityScore: number = 0;
  @Output() view = new EventEmitter<string>();
  @Output() delete = new EventEmitter<string>();
  @Output() search = new EventEmitter<string>();

  onView(): void {
    this.view.emit(this.image.id);
  }

  onDelete(): void {
    if (confirm('Delete this image?')) {
      this.delete.emit(this.image.id);
    }
  }

  onSearch(): void {
    this.search.emit(this.image.id);
  }

  onImageError(event: Event): void {
    const imgElement = event.target as HTMLImageElement;
    imgElement.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"><rect width="200" height="200" fill="%23f0f0f0"/><text x="100" y="100" font-family="Arial" font-size="14" fill="%23999" text-anchor="middle" dy=".3em">Image</text></svg>';
  }

  formatDate(dateString: string): string {
    return new Date(dateString).toLocaleDateString();
  }
}