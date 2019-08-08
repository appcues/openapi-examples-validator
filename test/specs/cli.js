const
    exec = require('child_process').exec,
    {
        getPathOfTestData
    } = require('../util/setup-tests');

const CMD__RUN = 'node dist/cli.js';

describe('CLI-module, with', () => {
    describe('valid examples, but with missing schema', () => {
        it('should write to stout', (done) => {
            exec(`${ CMD__RUN } ${ getPathOfTestData('simple-example') }`, (err, stdout) => {
                stdout.should.not.equal('');
                done();
            });
        });
    });
    describe('invalid examples', () => {
        it('should write to stdout and stderr', (done) => {
            exec(`${ CMD__RUN } ${ getPathOfTestData('multiple-errors') }`, (err, stdout, stderr) => {
                stdout.should.not.equal('');
                stderr.should.not.equal('');
                done();
            });
        });
    });
});
