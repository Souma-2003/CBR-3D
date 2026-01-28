import { Component } from '@angular/core';
import { BackendService } from '../../services/backend.service';

@Component({
  selector: 'app-upload',
  templateUrl: './upload.component.html',
  styleUrls: ['./upload.component.css']
})
export class UploadComponent {
  selectedFile: File | null = null;
  previewUrl: string | ArrayBuffer | null = null;
  isUploading = false;
  uploadMessage = '';
  uploadSuccess = false;

  constructor(private backendService: BackendService) {}

  onFileSelected(event: any): void {
    const file = event.target.files[0];
    if (file) {
      this.selectedFile = file;
      const reader = new FileReader();
      reader.onload = (e) => {
        this.previewUrl = e.target?.result || null;
      };
      reader.readAsDataURL(file);
    }
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      const file = files[0];
      this.selectedFile = file;
      const reader = new FileReader();
      reader.onload = (e) => {
        this.previewUrl = e.target?.result || null;
      };
      reader.readAsDataURL(file);
    }
  }

  async upload(): Promise<void> {
    if (!this.selectedFile) {
      this.showMessage('Please select a file first', false);
      return;
    }

    this.isUploading = true;
    this.uploadMessage = 'Uploading image...';
    this.uploadSuccess = false;

    try {
      const result = await this.backendService.uploadImage(this.selectedFile);
      this.showMessage('Image uploaded successfully!', true);
      console.log('Upload result:', result);
      this.uploadSuccess = true;
      
      // Reset after 3 seconds
      setTimeout(() => {
        this.clear();
        this.uploadSuccess = false;
      }, 3000);
    } catch (error: any) {
      this.showMessage(`Upload failed: ${error.message}`, false);
    } finally {
      this.isUploading = false;
    }
  }

  showMessage(message: string, isSuccess: boolean): void {
    this.uploadMessage = message;
    this.uploadSuccess = isSuccess;
  }

  clear(): void {
    this.selectedFile = null;
    this.previewUrl = null;
    this.uploadMessage = '';
  }
}