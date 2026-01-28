import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { HttpClientModule } from '@angular/common/http';
import { ReactiveFormsModule, FormsModule } from '@angular/forms';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';

// Import des composants
import { DetectionComponent } from './pages/detection/detection.component';
import { DashboardComponent } from './pages/dashboard/dashboard.component';
import { UploadComponent } from './pages/upload/upload.component';
import { SearchComponent } from './pages/search/search.component';
import { HistoryComponent } from './pages/history/history.component';
import { Search3dComponent } from './pages/search-3d/search-3d.component';

// Import des composants partagés
import { NavbarComponent } from './shared/components/navbar/navbar.component';
import { ImageCardComponent } from './shared/components/image-card/image-card.component';
import { LoaderComponent } from './shared/components/loader/loader.component';
import { ModalComponent } from './shared/components/modal/modal.component';
import { DetectedObjectsComponent } from './shared/components/detected-objects/detected-objects.component';

// Import des services
import { BackendService } from './services/backend.service';
import { YoloService } from './core/services/yolo.service';
import { DescriptorSearchService } from './core/services/descriptor-search.service';

@NgModule({
  declarations: [
    AppComponent,
    DetectionComponent,
    DashboardComponent,
    UploadComponent,
    SearchComponent,
    HistoryComponent,
    Search3dComponent,
    NavbarComponent,
    ImageCardComponent,
    LoaderComponent,
    ModalComponent,
    DetectedObjectsComponent
  ],
  imports: [
    BrowserModule,
    CommonModule,
    AppRoutingModule,
    HttpClientModule,
    ReactiveFormsModule,
    FormsModule,
    BrowserAnimationsModule,
    RouterModule
  ],
  providers: [
    BackendService,
    YoloService,
    DescriptorSearchService
  ],
  bootstrap: [AppComponent]
})
export class AppModule { }