import React from 'react';
import ReactDOM from 'react-dom';
import { Provider } from 'react-redux';
import WebFont from 'webfontloader';
import App from './components/App';
import configureStore from './redux/configure';
import * as serviceWorker from './serviceWorker';
import 'normalize.css';
import GlobalStyles from './index.styled';

WebFont.load({
  google: {
    families: [
      'Lato',
      'Rubik:800',
    ]
  }
});

ReactDOM.render(
  <Provider store={configureStore()}>
    <App />
    <GlobalStyles />
  </Provider>,
  document.getElementById('root'),
);

// If you want your app to work offline and load faster, you can change
// unregister() to register() below. Note this comes with some pitfalls.
// Learn more about service workers: https://bit.ly/CRA-PWA
serviceWorker.unregister();
