import styled from 'styled-components';

export default styled.button`
  appearance: none;
  box-shadow: 8px 8px #282828;
  background-color: #ffffff;
  border-radius: 0;
  border: 1px solid #282828;
  cursor: pointer;
  font-family: 'Rubik', sans-serif;
  font-weight: 800;
  position: relative;
  text-transform: uppercase;
  padding: 10px;

  &:active {
    box-shadow: none;
    left: 2px;
    top: 2px;
  }

  &:hover {
    background-color: #EADEAD;
  }
`;