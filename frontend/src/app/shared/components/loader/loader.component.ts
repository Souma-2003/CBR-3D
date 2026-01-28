import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-loader',
  templateUrl: './loader.component.html',
  styleUrls: ['./loader.component.css']
})
export class LoaderComponent {
  @Input() message: string = 'Loading...';
  @Input() size: string = 'medium';

  getSpinnerClass(): string {
    const classes: {[key: string]: string} = {
      'small': 'spinner-small',
      'medium': 'spinner-medium',
      'large': 'spinner-large'
    };
    return classes[this.size] || classes['medium'];
  }
}