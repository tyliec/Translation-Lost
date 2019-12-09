/*
 *  ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
 *  Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: Apache-2.0
 *  ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
 */

'use strict';

module.exports = {
    manifest: {
        publishingInformation: {
            isAvailableWorldwide: false,
            distributionCountries: ['US'],
            distributionMode: 'PUBLIC',
            category: 'GAMES',
            testingInstructions: 'replace with testing instructions',
            locales: {
                'en-US': {
                    name: 'Translation Lost',
                    invocation: 'Translation Lost',
                    summary: "a game where you try and understand Alexa's accents",
                    description: 'Longer description, goes to the skill store. Line breaks are supported.',
                    examplePhrases: [
                        'Alexa, launch Translation lost',
                        'Alexa, open Translation lost',
                        'Alexa, play Translation lost',
                    ],
                    keywords: [
                        'game',
                        'fun',
                        'single player',
                        'modify this list as appropriate'
                    ]
                }
            }
        },
        privacyAndCompliance: {
            allowsPurchases: false,
            usesPersonalInfo: false,
            isChildDirected: false,
            isExportCompliant: true,
            containsAds: false,
            locales: {
                'en-US': {
                    privacyPolicyUrl: 'https://www.example.com/privacy.html',
                    termsOfUseUrl: 'https://www.example.com/terms.html'
                }
            }
        }
    }
};
