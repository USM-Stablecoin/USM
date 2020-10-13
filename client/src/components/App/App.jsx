import React from 'react';
import {connect} from 'react-redux';
import Connection from '../Connection/Connection';
import USMFUM from '../../USMFUM';
import {loggedInSelector} from '../../redux/selectors';
import Container from '../Container';
import Header from '../Header';
import AppStyled from './App.styled';

// TODO:
// - Move USM Mint form into component class
// - Initialize Proxy Contract and USM on connect
// - Update expected USM from mint using USM functions
// - Mint successfully
// - Add Burn Form
// - Add Fum Fund
// - Add Fum Defund

function App({ dispatch, loggedIn }) {
  return (
    <AppStyled>
      <Container>
        <Header />
        {loggedIn === false ? <Connection /> : <USMFUM />}
      </Container>
    </AppStyled>
  );
}

function mapStateToProps(state){
	return {
		loggedIn: loggedInSelector(state),
	}
}

export default connect(mapStateToProps)(App);
