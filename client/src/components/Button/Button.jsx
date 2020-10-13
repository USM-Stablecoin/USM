import React from 'react';

import ButtonStyled from './Button.styled';

function Button({ children, onClick }) {
  return (
    <ButtonStyled onClick={onClick}>
      { children }
    </ButtonStyled>
  );
};

export default Button;