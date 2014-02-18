var util = require('util');
var Cabs = require('./cabs');
var Chunker = require('./chunker');
var streams = require('readable-stream');
var Transform = streams.Transform;
var PassThrough = streams.PassThrough;
var pipeline = require('stream-combiner');
var duplexer = require('duplexer');
var through = require('through2');
var path = require('path');
var fs = require('fs');
var mkdirp = require('mkdirp');
var crypto = require("crypto");

function flatten(){
  var out = new PassThrough({
    objectMode: true,
    decodeStrings: false
  });
  var thing = through({
    objectMode: true,
    decodeStrings: false
  },function (chunk, _, next){
    chunk.pipe(out, {end: false});
    chunk.on('end',function () {
      next();
    });
  }, function (next) {
    out.emit('end');
    next();
  });
  return duplexer(thing, out);
}
function psudoRandomish(){
  return Date.now().toString(36) +
    Math.random().toString(36).slice(2);
}

util.inherits(ReadCabs, Transform);

function ReadCabs(basePath) {
  if (!(this instanceof ReadCabs)) {
    return new ReadCabs(basePath);
  }
  Transform.call(this, {
    objectMode:true
  });
  this.cabs = new Cabs(basePath);
}
ReadCabs.prototype._transform = function (chunk, _, callback) {
  this.push(this.cabs.read(typeof chunk === 'string'? chunk : chunk.hash));
  callback();
};
Cabs.read  = function (path, hash, limit){
  var cabs = new Cabs({
    path: path,
    hashFunc: hash,
    limit: limit
  });
  return cabs.readStream();
};
Cabs.write = function (path, hash, limit){
  var cabs = new Cabs({
    path: path,
    hashFunc: hash,
    limit: limit
  });
  return cabs.writeStream();
};
Cabs.writeFile = function (path, hash, limit){
  var cabs = new Cabs({
    path: path,
    hashFunc: hash,
    limit: limit
  });
  return cabs.writeFile();
};
Cabs.prototype.writeStream = function() {
  return new Chunker(this, this.limit);
};
Cabs.prototype.readStream = function() {
  var read = new ReadCabs(this.basePath);
  return pipeline(read, flatten());
};
Cabs.prototype.writeFile = function () {
  var self = this;
  var hash = crypto.createHash(this.hashFunc);
  var tempPath = path.join(this.basePath, 'tmp');
  var tempFile = path.join(tempPath, psudoRandomish());
  var psopts = {
    objectMode: true,
    decodeStrings: false
  };
  var output = new PassThrough(psopts);
  var input = new PassThrough(psopts);
  mkdirp(tempPath, function (err){
    if (err) {
      output.emit('error', err);
      return;
    }
    var fstream = fs.createWriteStream(tempFile);
    input.pipe(hash);
    input.pipe(fstream);
    input.on('end', function (){
      var fileHash = hash.read().toString('hex');
      var hashPath = self.hashPaths(fileHash);
      mkdirp(hashPath.folder, function (err){
        if (err) {
          output.emit('error', err);
          return;
        }
        var outStream = fs.createWriteStream(hashPath.full);
        var fromTemp = fs.createReadStream(tempFile);
        fromTemp.pipe(outStream);
        fromTemp.on('end', function (){
          fs.unlink(tempFile, function (err) {
            if (err) {
              output.emit('error', err);
            } else {
              fs.rmdir(tempPath, function () {
                output.write(fileHash);
                output.end();
              });
            }
          });
        });
      });
    });
  });
  return duplexer(input, output);
};
module.exports = Cabs;
