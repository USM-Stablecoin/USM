import React, { Component } from 'react';
import {connect} from 'react-redux';
import { selectUsmForm, setMintEthValue, setMintUsmValue } from './redux/actions';
import { mintEthValueSelector, mintUsmValueSelector, selectedUsmFormSelector } from './redux/selectors';

class FUM extends Component {

    printFumFund(props) {

		return (
			<div id="fund-fum-container" className="nes-container is-rounded with-title">
				<p className="title">Fund</p>
				<form id="fund-fum-form" className="">
					<div className="nes-field is-inline">
						<label htmlFor="fund-fum-eth">ETH Amount</label>
						<input id="fund-fum-eth" className="nes-input" type="number" min="0" step=".01" placeholder="ETH" />
					</div>
					<div className="nes-field is-inline">
						<label htmlFor="fund-fum-usm">FUM Amount</label>
						<input id="fund-fum-usm" className="nes-input" type="number" min="0" step=".01" placeholder="FUM" />
					</div>
					<button type="submit" className="nes-btn is-primary">Fund</button>
				</form>
			</div>
		);
	}


    render() {

        const {dispatch} = this.props;
        
        return (
            <div className="row">
                <div id="usm-container" className="nes-container with-title is-rounded is-centered">
                    <p className="title">FUM</p>
                    <button type="button" className="nes-btn is-success">Fund</button>
                    <button type="button" className="nes-btn is-error">Defund</button>
                    {this.printFumFund(this.props)}					
                </div>
            </div>
        )
    }
}

function mapStateToProps(state){
	return {
	}
}

export default connect(mapStateToProps)(FUM);