import { assert, expect } from 'chai';
import { ethers, ethereum } from "@nomiclabs/buidler";
import { Signer, utils } from "ethers";
const verbose = process.env.VERBOSE;

describe('SmartOrderRouter', function(){
    const toWei = utils.parseEther;
    const fromWei = utils.formatEther;
    const MAX = ethers.constants.MaxUint256;
    const errorDelta = 10 ** -8;

    let registry: any;
    let factory: any;
    let smartOrderRouter: any;
    let REGISTRY: any;
    let WETH: string;
    let MKR: string;
    let weth: any;
    let mkr: any;
    let _POOLS: any[] =[];
    let _pools: any[] =[];
    let adminSigner: any;
    let nonAdminSigner: any;
    let admin: string;
    let nonAdmin: string;

    before(async () => {
        const BRegistry = await ethers.getContractFactory('BRegistry');
        const SmartOrderRouter = await ethers.getContractFactory('SmartOrderRouter');
        const BFactory = await ethers.getContractFactory('BFactory');
        const BPool = await ethers.getContractFactory('BPool');
        const TToken = await ethers.getContractFactory('TToken');
        [adminSigner, nonAdminSigner] = await ethers.getSigners();
        admin = await adminSigner.getAddress();
        nonAdmin = await nonAdminSigner.getAddress();
        factory = await BFactory.deploy();
        await factory.deployed();

        registry = await BRegistry.deploy(factory.address);
        await registry.deployed();

        smartOrderRouter = await SmartOrderRouter.deploy(registry.address);
        await smartOrderRouter.deployed();

        weth = await TToken.deploy('Wrapped Ether', 'WETH', 18);
        mkr = await TToken.deploy('Maker', 'MKR', 18);
        await weth.deployed();
        await mkr.deployed();

        WETH = weth.address;
        MKR = mkr.address;

        // Admin balances
        await weth.mint(admin, toWei('1000000000000000000000'));
        await mkr.mint(admin,  toWei('1000000000000000000000'));

        // Copy pools printed by https://github.com/balancer-labs/python-SOR/blob/master/Onchain_SOR_test_comparison.py
        // For the following inputs:
        // num_pools = 5 # Number of pools available for this pair
        // max_n_pools = 4
        // swap_type = "swapExactOut"
        // input_amount = 100000 # Number of tokens in the trader wants to sell
        // output_token_eth_price = 0 # One output token buys 0.01 eth
        // seed = 1
        let poolsData = [
            {   'Bmkr': 1033191.1981189704,
                'Bweth': 21709.92411864851,
                'Wmkr': 8.261291241849618,
                'Wweth': 1.7387087581503824,
                'fee': 0.015},
            {   'Bmkr': 911870.2026231368,
                'Bweth': 30347.518852549234,
                'Wmkr': 7.509918308978633,
                'Wweth': 2.4900816910213672,
                'fee': 0.025},
            {   'Bmkr': 1199954.250073062,
                'Bweth': 72017.58337846321,
                'Wmkr': 6.235514183655618,
                'Wweth': 3.764485816344382,
                'fee': 0.01},
            {   'Bmkr': 1079066.970947264,
                'Bweth': 77902.62602094973,
                'Wmkr': 5.8258602061546405,
                'Wweth': 4.1741397938453595,
                'fee': 0.01},
            {   'Bmkr': 1141297.6436731548,
                'Bweth': 128034.7686206643,
                'Wmkr': 4.689466127973144,
                'Wweth': 5.310533872026856,
                'fee': 0.005}
        ]

        for (var i = 0; i < poolsData.length; i++) {
            let poolAddr = await factory.callStatic.newBPool();
            _POOLS.push(poolAddr);
            await factory.newBPool();
            let poolContract = await ethers.getContractAt("BPool", poolAddr);
            _pools.push(poolContract);

            await weth.approve(_POOLS[i], MAX);
            await mkr.approve(_POOLS[i], MAX);

            await _pools[i].bind(WETH, toWei(poolsData[i]['Bweth'].toString()), toWei(poolsData[i]['Wweth'].toString()));
            await _pools[i].bind(MKR, toWei(poolsData[i]['Bmkr'].toString()), toWei(poolsData[i]['Wmkr'].toString()));
            await _pools[i].setSwapFee(toWei(poolsData[i]['fee'].toString()));

            await _pools[i].finalize();
            /*
            console.log("Pool "+i.toString()+": "+_POOLS[i]+", Liquidity WETH-MKR: "+
                await registry.getNormalizedLiquidity.call(MKR, WETH, _POOLS[i]))
            */
        }

        // Proposing registry. NOTICE _POOLS[0] has been left out since it would make up less than 10% of total liquidity
        await registry.addPools([_POOLS[1], _POOLS[2], _POOLS[3], _POOLS[4]], MKR, WETH);
        await registry.sortPools([MKR, WETH], 10);
    });

    it('Should not allow non-controller to change Registry Address.', async () => {
        await expect(
          smartOrderRouter.connect(nonAdminSigner).setRegistryAddress('0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2')
        ).to.be.revertedWith("ERR_NOT_CONTROLLER");
    })

    it('Controller can change Registry Address.', async () => {
        let regAddr = await smartOrderRouter.getRegistryAddress();
        expect(regAddr).to.equal(registry.address);
        await smartOrderRouter.setRegistryAddress('0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2');
        regAddr = await smartOrderRouter.getRegistryAddress();
        expect(regAddr).to.equal('0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2');
        await smartOrderRouter.setRegistryAddress(registry.address);
    })

    it('SimplifiedCalcSplit swapExactOut, input_amount = 100,000', async () => {
        // !!!!!!! getBestPoolsWithLimit should probably be used (also in Contract)
        let pools1 = await registry.getBestPoolsWithLimit(MKR, WETH, 10)
        let pools = await registry.getPoolsWithLimit(MKR, WETH, 0, 10)

        console.log(pools1);
        console.log(pools);

        // _POOLS[0] has been correctly left out of new proposal since it would make up less than 10% of total liquidity
        // result = await smartOrderRouter.viewSimplifiedSplit(MKR, WETH, toWei('100000'),4); // Sell 100000 WETH for MKR
        let result = await smartOrderRouter.viewSplit(false, MKR, WETH, toWei('100000'), 4); // Sell 100000 WETH for MKR
        /*
        Returns:
        Array of swaps:
            struct Swap {
                address pool;
                uint    tokenInParam; // tokenInAmount / maxAmountIn / limitAmountIn
                uint    tokenOutParam; // minAmountOut / tokenAmountOut / limitAmountOut
                uint    maxPrice;
            }
        totalOutput value
        */
        // result.swaps[0].tokenOutParam.toString() is Same as: result['swaps'][0][2]
        assert.equal(result.swaps[0].tokenOutParam.toString(), "34681223095510744100000");
        assert.equal(result.swaps[1].tokenOutParam.toString(), "26215324499553495700000");
        assert.equal(result.swaps[2].tokenOutParam.toString(), "25939039858875108300000");
        assert.equal(result.swaps[3].tokenOutParam.toString(), "13164412546060651900000");
        assert.equal(result.totalOutput.toString(), "1434955757400869016687020");

        // // pools should be in right order
        // assert.equal(result['swaps'][0][0].pool.toString(),pools[3]);
        // assert.equal(result['swaps'][1][0].pool.toString(),pools[2]);
        // assert.equal(result['swaps'][2][0].pool.toString(),pools[1]);
        // assert.equal(result['swaps'][3][0].pool.toString(),pools[0]);
    });

    it('SimplifiedCalcSplit swapExactIn, input_amount = 10,000', async () => {

        let pools1 = await registry.getBestPoolsWithLimit(MKR, WETH, 10)
        let pools = await registry.getPoolsWithLimit(MKR, WETH, 0, 10)

        console.log(pools)
        // _POOLS[0] has been correctly left out of new proposal since it would make up less than 10% of total liquidity
        // result = await smartOrderRouter.viewSimplifiedSplit(MKR, WETH, toWei('100000'),4); // Sell 100000 WETH for MKR
        let result = await smartOrderRouter.viewSplit(true, MKR, WETH, toWei('10000'), 4); // Sell 100000 WETH for MKR
        console.log("totalOutput: "+result['totalOutput'].toString());
        // // Split amounts should be correct:
        // console.log(result[0].toString());
        console.log("totalOutput: "+result[1].toString());
        // console.log(JSON.stringify(result))
        assert.equal(result['swaps'][0][1].toString(),"3468122309551074410000");
        assert.equal(result['swaps'][1][1].toString(),"2621532449955349570000");
        assert.equal(result['swaps'][2][1].toString(),"2593903985887510830000");
        assert.equal(result['swaps'][3][1].toString(),"1316441254606065190000");

        // // pools should be in right order
        // assert.equal(result['swaps'][0][0].pool.toString(),pools[3]);
        // assert.equal(result['swaps'][0][1].pool.toString(),pools[2]);
        // assert.equal(result['swaps'][0][2].pool.toString(),pools[1]);
        // assert.equal(result['swaps'][0][3].pool.toString(),pools[0]);
    });
});