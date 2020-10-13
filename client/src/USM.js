import React, { Component } from 'react'
import { connect } from 'react-redux'
import { selectUsmForm, setMintEthValue, setMintUsmValue } from './redux/actions'
import { mintEthValueSelector, mintUsmValueSelector, selectedUsmFormSelector } from './redux/selectors'

class USM extends Component {
  printUsmMint(props, changeMintEthValue, changeMintUsmValue) {
    const { mintUsmValue, mintEthValue } = props

    return (
      <div id="mint-usm-container" className="nes-container is-rounded with-title">
        <p className="title">Mint</p>
        <form id="mint-usm-form" className="">
          <div className="nes-field is-inline">
            <label htmlFor="mint-usm-eth">ETH Amount</label>
            <input
              id="mint-usm-eth"
              onChange={changeMintEthValue}
              value={mintEthValue}
              className="nes-input"
              type="number"
              min="0"
              step=".01"
              placeholder="ETH"
            />
          </div>
          <div className="nes-field is-inline">
            <label htmlFor="mint-usm-usm">USM Amount</label>
            <input
              id="mint-usm-usm"
              onChange={changeMintUsmValue}
              value={mintUsmValue}
              className="nes-input"
              type="number"
              min="0"
              step=".01"
              placeholder="USM"
            />
          </div>
          <button type="submit" className="nes-btn is-primary">
            Mint
          </button>
        </form>
      </div>
    )
  }

  printUsmRedeem(props, changeRedeemUsmValue, redeemEthValue) {
    return <></>
  }

  render() {
    const USM_MINT = 'usm_mint'
    const USM_REDEEM = 'usm_redeem'

    const { dispatch, selectedUsmForm } = this.props
    const changeMintEthValue = (e) => dispatch(setMintEthValue(e.target.value))
    const changeMintUsmValue = (e) => dispatch(setMintUsmValue(e.target.value))
    const usmForm = (mintOrRedeem) => dispatch(selectUsmForm(mintOrRedeem))

    return (
      <div className="row">
        <div id="usm-container" className="nes-container with-title is-rounded is-centered">
          <p className="title">USM</p>
          <button onClick={() => usmForm(USM_MINT)} type="button" className="nes-btn is-success">
            Mint
          </button>
          <button onClick={() => usmForm(USM_REDEEM)} type="button" className="nes-btn is-error">
            Redeem
          </button>
          {selectedUsmForm == USM_MINT
            ? this.printUsmMint(this.props, changeMintEthValue, changeMintUsmValue)
            : this.printUsmRedeem(this.props)}
        </div>
      </div>
    )
  }
}

function mapStateToProps(state) {
  return {
    selectedUsmForm: selectedUsmFormSelector(state),
    mintUsmValue: mintUsmValueSelector(state),
    mintEthValue: mintEthValueSelector(state),
  }
}

export default connect(mapStateToProps)(USM)
