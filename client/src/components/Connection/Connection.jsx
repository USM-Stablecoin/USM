import React from 'react';
import { connect } from 'react-redux';
import { loadWeb3 } from '../../redux/interactions';

import Button from '../Button';

import ConnectionStyled from './Connection.styled';

function Connection({ dispatch }) {
  const connectWeb3 = () => loadWeb3(dispatch);

  return (
    <ConnectionStyled>
      <h3 className="h1">Connect your Ethereum wallet</h3>
      <p>Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.</p>
      <Button onClick={connectWeb3} type="button">
        Connect
      </Button>
    </ConnectionStyled>
  );
};

function mapStateToProps(state) {
  return {};
};

export default connect(mapStateToProps)(Connection);