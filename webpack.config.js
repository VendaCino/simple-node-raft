const path = require('path');
const webpack = require('webpack');
const UglifyJsPlugin = require('uglifyjs-webpack-plugin');

module.exports = {
    entry: {
        'tsstream': './src/simple-raft-main.ts',
        'tsstream.min': './src/simple-raft-main.ts'
    },
    output: {
        path: path.resolve(__dirname, 'dist/umd'),
        filename: '[name].js',
        libraryTarget: 'umd',
        library: 'Sequency',
        umdNamedDefine: true
    },
    resolve: {
        extensions: ['.ts']
    },
    devtool: 'source-map',
    module: {
        rules: [{
            test: /\.ts$/,
            loader: 'awesome-typescript-loader',
            exclude: /node_modules/,
            query: {
                declaration: false
            }
        }]
    },
    optimization: {
        minimize: true,
        minimizer: [new UglifyJsPlugin({
            include: /\.min\.js$/
        })]
    }
};
