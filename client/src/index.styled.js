import { createGlobalStyle } from 'styled-components';

export default createGlobalStyle`
  * {
    box-sizing: border-box;
  }

  body {
    color: #282828;
    margin: 0;
    font-size: 16px;
    font-family: 'Lato', sans-serif;
  }

  a {
    color: #282828;
    text-decoration: none;
  }

  .h1,
  .h2,
  .h3 {
    font-family: 'Rubik', sans-serif;
    font-weight: 900;
    text-transform: uppercase;
  }

  .h1 {
    font-size: 2em;
    letter-spacing: 0.04em;
  }

  .h2 {
    font-size: 1.5em;
  }

  .h3 {
    font-size: 1.17em;
  }
`;