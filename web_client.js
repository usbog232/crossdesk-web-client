const iceConnectionLog = document.getElementById('ice-connection-state'),
  iceGatheringLog = document.getElementById('ice-gathering-state'),
  signalingLog = document.getElementById('signaling-state'),
  dataChannelLog = document.getElementById('data-channel');

clientId = "000000";
const websocket = new WebSocket('wss://api.crossdesk.cn:9090');

websocket.onopen = () => {
  document.getElementById('connect').disabled = false;
  sendLogin();
}

websocket.onmessage = async (evt) => {
  if (typeof evt.data !== 'string') {
    return;
  }
  const message = JSON.parse(evt.data);
  if (message.type == "login") {
    clientId = message.user_id.split("@")[0];
    console.log("logged in as " + clientId);

  } else if (message.type == "offer") {
    await handleOffer(message)
  }
}

let pc = null;
let dc = null;

function createPeerConnection() {
  const config = {
    bundlePolicy: "max-bundle",
  };

  if (document.getElementById('use-stun').checked) {
    config.iceServers = [{ urls: ['stun:api.crossdesk.cn:3478'] }];
  }

  let pc = new RTCPeerConnection(config);

  // Register some listeners to help debugging
  pc.addEventListener('iceconnectionstatechange', () =>
    iceConnectionLog.textContent += ' -> ' + pc.iceConnectionState);
  iceConnectionLog.textContent = pc.iceConnectionState;

  pc.addEventListener('icegatheringstatechange', () =>
    iceGatheringLog.textContent += ' -> ' + pc.iceGatheringState);
  iceGatheringLog.textContent = pc.iceGatheringState;

  pc.addEventListener('signalingstatechange', () =>
    signalingLog.textContent += ' -> ' + pc.signalingState);
  signalingLog.textContent = pc.signalingState;

  // Receive audio/video track
  // More robust handling of audio/video track
  pc.ontrack = (evt) => {
    console.log('ontrack event:', evt);
    const video = document.getElementById('video');

    // Only handle video track
    if (evt.track.kind !== 'video') return;

    // Don't reset srcObject if stream already exists
    if (!video.srcObject) {
      const stream = evt.streams && evt.streams[0] ? evt.streams[0] : new MediaStream([evt.track]);
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      // Set delayed playback
      setTimeout(() => {
        video.play().catch(err => {
          console.warn('video.play() failed:', err);
        });
      }, 500);
      console.log('attached new video stream:', stream.id);
    } else {
      // Add track directly to existing stream
      video.srcObject.addTrack(evt.track);
      console.log('added track to existing stream:', evt.track.id);
    }

  };

  // Receive data channel
  pc.ondatachannel = (evt) => {
    dc = evt.channel;

    dc.onopen = () => {
      dataChannelLog.textContent += '- open\n';
      dataChannelLog.scrollTop = dataChannelLog.scrollHeight;
    };

    let dcTimeout = null;
    dc.onmessage = (evt) => {
      if (typeof evt.data !== 'string') {
        return;
      }

      dataChannelLog.textContent += '< ' + evt.data + '\n';
      dataChannelLog.scrollTop = dataChannelLog.scrollHeight;

      dcTimeout = setTimeout(() => {
        if (!dc) {
          return;
        }
        const message = `Pong ${currentTimestamp()}`;
        dataChannelLog.textContent += '> ' + message + '\n';
        dataChannelLog.scrollTop = dataChannelLog.scrollHeight;
        dc.send(message);
      }, 1000);
    }

    dc.onclose = () => {
      clearTimeout(dcTimeout);
      dcTimeout = null;
      dataChannelLog.textContent += '- close\n';
      dataChannelLog.scrollTop = dataChannelLog.scrollHeight;
    };
  }

  return pc;
}

async function waitGatheringComplete() {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') {
      resolve();
    } else {
      pc.addEventListener('icegatheringstatechange', () => {
        if (pc.iceGatheringState === 'complete') {
          resolve();
        }
      });
    }
  });
}

async function sendAnswer(pc) {
  await pc.setLocalDescription(await pc.createAnswer());
  await waitGatheringComplete();

  const answer = pc.localDescription;

  msg = JSON.stringify({
    type: "answer",
    transmission_id: getTransmissionId(),
    user_id: clientId,
    remote_user_id: getTransmissionId(),
    sdp: answer.sdp,
  });
  console.log("send answer: " + msg);

  websocket.send(msg);
}

async function handleOffer(offer) {
  pc = createPeerConnection();
  await pc.setRemoteDescription(offer);
  await sendAnswer(pc);
}

function sendLogin() {
  websocket.send(JSON.stringify({
    type: "login",
    user_id: "",
  }));
  console.log("send login");
}

function leaveTransmission() {
  websocket.send(JSON.stringify({
    type: "leave_transmission",
    user_id: clientId,
    transmission_id: getTransmissionId(),
  }));
}

function getTransmissionId() {
  return document.getElementById('transmission-id').value;
}

// Add function to get password
function getTransmissionPwd() {
  return document.getElementById('transmission-pwd').value;
}

// Modify sendRequest function to use dynamic password
function sendRequest() {
  websocket.send(JSON.stringify({
    type: "join_transmission",
    user_id: clientId,
    transmission_id: getTransmissionId() + '@' + getTransmissionPwd(),
  }));
}

function connect() {
  document.getElementById('connect').style.display = 'none';
  document.getElementById('disconnect').style.display = 'inline-block';
  document.getElementById('media').style.display = 'block';
  sendRequest();
}

function disconnect() {
  document.getElementById('disconnect').style.display = 'none';
  document.getElementById('media').style.display = 'none';
  document.getElementById('connect').style.display = 'inline-block';

  leaveTransmission();

  // close data channel
  if (dc) {
    dc.close();
    dc = null;
  }

  // close transceivers
  if (pc.getTransceivers) {
    pc.getTransceivers().forEach((transceiver) => {
      if (transceiver.stop) {
        transceiver.stop();
      }
    });
  }

  // close local audio/video
  pc.getSenders().forEach((sender) => {
    const track = sender.track;
    if (track !== null) {
      sender.track.stop();
    }
  });

  // close peer connection
  pc.close();
  pc = null;
}


// Helper function to generate a timestamp
let startTime = null;
function currentTimestamp() {
  if (startTime === null) {
    startTime = Date.now();
    return 0;
  } else {
    return Date.now() - startTime;
  }
}

