export interface SearchResult {
  imageId: string;
  imageUrl: string;
  similarityScore: number;
  metadata: {
    filename: string;
    uploadDate: string;
    size: number;
  };
  highlights?: {
    boundingBoxes: number[][];
    matchingObjects: string[];
  };
}

export interface SearchQuery {
  type: 'image' | 'object' | 'text';
  imageId?: string;
  objectIndex?: number;
  features?: number[];
  text?: string;
  objectType?: string;  // Ajoutez cette ligne
  timestamp: string;
}