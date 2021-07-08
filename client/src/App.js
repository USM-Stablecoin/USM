import React, { Component } from 'react';
import {connect} from 'react-redux';
import './App.scss';
import Connection from './Connection';
import USMFUM from './USMFUM';
import {loggedInSelector} from './redux/selectors';

// TODO:
// - Move USM Mint form into component class
// - Initialize Proxy Contract and USM on connect
// - Update expected USM from mint using USM functions
// - Mint successfully
// - Add Burn Form
// - Add Fum Fund
// - Add Fum Defund

class App extends Component {

	render() {

		const {dispatch, loggedIn} = this.props;

		return (
			<div className="container">
				{loggedIn === false ? <Connection /> : <USMFUM />}
			</div>
		);
	}
}

function mapStateToProps(state){
	return {
		loggedIn: loggedInSelector(state),
	}
}

export default connect(mapStateToProps)(App);
