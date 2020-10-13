import styled from 'styled-components';

export default styled.header`
  align-items: center;
  display: flex;
  font-family: 'Rubik', sans-serif;
  font-weight: 800;
  justify-content: space-between;
  padding: 20px 0;

  a {
    text-transform: uppercase;

    &:hover {
      opacity: 0.8;
    }
  }
`;