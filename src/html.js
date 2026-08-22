import htm from 'htm';
import { createElement } from 'react';

// htm bound to React.createElement so components can use tagged-template markup
// instead of JSX, keeping the project build-step free.
export const html = htm.bind(createElement);
