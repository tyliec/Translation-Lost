/*
 *  ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
 *  Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: Apache-2.0
 *  ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
 */

'use strict';

module.exports = {
    name: 'lost-in-translation',
    deployments: {
        development: {
            module: '@litexa/deploy-aws',
            S3BucketName: 'lost-in-translation',
            askProfile: 'default',
            awsProfile: 'default'
        },
        production: {
            module: '@litexa/deploy-aws',
            S3BucketName: 'lost-in-translation',
            askProfile: 'default',
            awsProfile: 'default'
        }
    },
    extensionOptions: {}
};
