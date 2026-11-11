import { render } from 'preact';
import { App } from './App.tsx';
import { onLinkClick } from './router.ts';
import './styles.css';

document.addEventListener('click', onLinkClick);
render(<App />, document.getElementById('app')!);
