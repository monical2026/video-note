import { render } from 'preact';
import { App } from './App';
import { normalizeTheme } from '../../src/storage/settings';
import './style.css';

// 首绘前同步应用上次主题（App.applyTheme 落下的 localStorage 镜像）：
// 真实设置要走异步 GET_SETTINGS（service worker 冷启动慢），不预应用会先渲染整屏亮色再翻转（FOUC）
document.documentElement.setAttribute('data-theme', normalizeTheme(localStorage.getItem('vn-theme')));

render(<App />, document.getElementById('root')!);
