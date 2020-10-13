import React from 'react';

import HeaderStyled from './Header.styled';

function Header() {
  return (
    <HeaderStyled>
      <h1 className="h2">
        stable
      </h1>

      <a
        href="https://link.medium.com/G7MtbXtIvab"
        target="_blank"
        rel="noopener noreferrer" 
      >
        About
      </a>
    </HeaderStyled>
  );
}

export default Header;