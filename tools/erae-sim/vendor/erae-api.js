// erae api sysexes 
//
// requires hmidi's midi i/o ports

// Erae 2 finger stream touches
// can be used by host program, 
//
class ETouch
{
	constructor()
	{
	// public targets
		this.action=0;
		this.finger_id =0;
		this.zone=0;
		this.x=0;
		this.y=0;
		this.z=0; // pressure 
	}
}

function bitized7size(len)
{
	return Math.floor(len / 7 * 8) + ((len % 7) !=0 ? 1 + len % 7 : 0);
}

/**
 @brief Get size of the resulting 8 bits bytes array obtained when using the unbitize7 function
*/
function unbitized7size(len)
{
	return Math.floor(len / 8 * 7) + ((len % 8) !=0 ? len % 8 - 1 : 0);
}

/**
*
* @brief 7-bitize an array of bytes and get the resulting checksum
* @param in_bytes Input array of 8 bit bytes
* @param inlen Length in bytes of the input array of 8 bits bytes
* @param out_midi An and array of bytes that will receive the 7-bitized bytes
* @return the output [out_midi , 7-bitized bytes XOR checksum]
*/
function bitize7chksum(in_bytes, inlen)
{
	var chksum = 0; // a uint_8
	var oa = [];
	for (var  i=0, outsize=0; i < inlen; i += 7, outsize += 8)
	{
		oa[outsize] = 0;
		for (var  j = 0; (j < 7) && (i + j < inlen); ++j)
		{
			oa[outsize] |= (in_bytes[i + j] & 0x80) >> (j + 1);
			oa[outsize + j + 1] = in_bytes[i + j] & 0x7F;
			chksum ^= oa[outsize + j + 1];
		}
		chksum ^= oa[outsize];
	}
	return [oa,chksum];
}

/**
Copyright © 2021-2022 EMBODME V22.06.27 12
* @brief 7-unbitize an array of bytes and get the incoming checksum
*
* @param in Input array of 7 bits bytes
* @param inlen Length in bytes of the input array of 7 bits bytes
* @param out An output object array of bytes that will receive the 7-unbitized bytes
* @return the input 7-bitized bytes XOR checksum
*/
function  unbitize7chksum(in_midi, inlen)
{
	var chksum = 0;
	var ob = []
 	for (var  i=0, outsize=0; i < inlen; i += 8, outsize += 7)
	{
		chksum ^= in_midi[i];
		for (var j = 0; (j < 7) && (j + 1 + i < inlen); ++j)
		{
			ob[outsize + j] = ((in_midi[i] << (j + 1)) & 0x80) | in_midi[i + j + 1];
			chksum ^= in_midi[i + j + 1];
		}
	}
	return [ob,chksum];
}

function unit_bit7()
{
	debugger;
// we'll have to see what MIDI comes in as .. Uint8Array?
	let a = [0xBE,0xEF,0xCA,0xFE];
	let [b,cks1] = bitize7chksum(a,a.length);
	// examine them here
	let [c,cks2] = unbitize7chksum(b, b.length);
}


//
// special ERAE2 version of sending sysex and getting responses. 
//
// try to avoid name conflicts. however
// we leverage the input and output ports... 
//
// this can send a sysex and let you wait for the response, says CHATGPT
// 40 is dev_id, 
const dev_id_e2 = 0x40;
// that 00 is a packet #
const syx_codes_e2  ={
	"ack": [0xf0,0x7e,dev_id_e2,0x7f,0x00,0xf7],
	"nak":[0xf0,0x7e,dev_id_e2,0x7e,0x00,0xf7],
	"cancel":[0xf0,0x7e,dev_id_e2,0x7e,0x00,0xf7],
	"F8":[0xf8],
	"F0":[0xf0]
};

// might not be needed.. send a request and pick up the response in the normal way. 
//
async function sendMIDISysexMessageAndWaitForResponse_e2(syxArray) {
    try {
        // Request MIDI access
        const output = current_out_port;
        const input = current_in_port; 

        if (!output || !input) {
            throw new Error("No available MIDI input or output devices.");
        }

        return new Promise((resolve) => {
            // Listener for incoming MIDI messages
            const onMIDISyxMessage = (event) => {
                const data = event.data; // Uint8Array received from MIDI input
                // console.log("Received MIDI Data:", data);
                var removeIt=true
                // check response.. be smarter about this
                if (arraysAreEqual(data, syx_codes_e2["ack"])) {
                    resolve("ACK");
                } else if (arraysAreEqual(data, syx_codes_e2["nak"])) {
                    resolve("NAK");
                } else if (arraysAreEqual(data, syx_codes_e2["cancel"])) {
                    resolve("CANCEL");
                } else if (arraysAreEqual(data, syx_codes_e2["F8"])) {
// ignore these clocks
                    removeIt=false;
                } else if (arraysAreEqual(data, syx_codes_e2["F0"])) {
// parse this if its a response and somehow get this back to the caller.. with the resolve 
                    removeIt=false;
                } else {
                    resolve("UNKNOWN");
                }

                // Remove event listener after receiving a response
                // well, i think there may be many responses. 
                if(removeIt)
                 {
                    input.removeEventListener("midimessage", onMIDISyxMessage);
                 }
            };

            // Add event listener to the input port
            input.addEventListener("midimessage", onMIDISyxMessage);

            // Send the MIDI message, a little bit pokey? 
            output.send(syxArray, window.performance.now() + 100.0 );
//            console.log("MIDI Message Sent:", syxArray);
        });

    } catch (error) {
        console.error("MIDI Error:", error);
    }
}

//
// can be called from MIDI callback
//
function api_response_parse(data){
                // console.log("Received MIDI Data:", data);
                 // check response.. be smarter about this
                if (arraysAreEqual(data, syx_codes_e2["ack"])) {
                    return("ACK");
                } else if (arraysAreEqual(data, syx_codes_e2["nak"])) {
                    return("NAK");
                } else if (arraysAreEqual(data, syx_codes_e2["cancel"])) {
                    return("CANCEL");
                }  else {
                    return("UNKNOWN");
                }
  }



//
// actual ERAE_2 calls
//
const syx_begin = [0xF0];
const syx_end = [0xF7];
const erae2_prefix = [0x00,0x21,0x50, 0x00,0x01, 0x00,0x02];

// what I can send as bb
const bb_Jhhl = [0x4A,0x68,0x68,0x6c];
//
// make these async?
// needs to pick up the responses!
//

function api_version(bb)
{
// bb is the bb string, up to 16 bytes.
//  It thin it's an id in case there are several eraes out there.
//
	const cmd = [0x01,0x01,0x04,0x7f].concat(bb);
	const syx = syx_begin.concat(erae2_prefix).concat(cmd).concat(syx_end);
	if(saved_out_port_id != 0)
	{
 	 current_out_port.send(syx); //omitting the timestamp means send immediately.
// apparently it replies with 
// 0xF0 BBs 0x7f 0x02 VERSION 0xF7
// pick this up upstairs.

	}
}


function api_enable(bb)
{
	const cmd = [0x01,0x01,0x04,0x01].concat(bb);
	const syx = syx_begin.concat(erae2_prefix).concat(cmd).concat(syx_end);
	if(saved_out_port_id != 0)
	{
 	 current_out_port.send(syx); 
	}	
}

function api_disable(bb)
{
	const cmd = [0x01,0x01,0x04,0x02].concat(bb);
	const syx = syx_begin.concat(erae2_prefix).concat(cmd).concat(syx_end);
	if(saved_out_port_id != 0)
	{
 	 current_out_port.send(syx); 
	}	
}



// this is to parse fingerstream MIDI sysexes!
// upstairs will know about ETOUCH
// 0xF0 BBS ACTION  FID1 … FID10 ZONE XYZ1 ... XYZ14 CHKS 0xF7
// returns true if goo, false if error
// pass in an etouch object
// bb must match
/*

240, // F0
 0, 1, 2, 3, // BB
 0, // Action
 0, 64, 35, 1, 0, 0, 0, 0, 0, 0, // Finger ID
 0, // zone 
114, 71, 121, 22, 65, 8, 117, 7, 48, 65, 18, 66, 17, 63,  // 7bit floats
110, cxsum
 247, // F7
 

actions: 0 touch down, 1 move, 2 touch up? 
*/
function fingerstream(fstream,bb,etouch)
{
	var i =0;
	if (! (fstream[i] == syx_begin))
		return false;
	i++;
// for some reason bb is not coming from the device.
	for(var bi =0; bi<bb.length;bi++)
	{
		if (! (fstream[i] == bb[bi]))
		return false;
		i++;
	}

	action = fstream[i];
	i++;
// then zone... doc is wrong
	zone = fstream[i];
	i++;
// finger id is 64 bit (probably a uuid)
	
	// these 14 bytes turn into 3 floats ?? 
	var f_id = [];
	for(var bi=0; bi<10;bi++)
	{
		f_id[bi] = fstream[i];
		i++;
	}

	
	const fid_a = new ArrayBuffer(8);
	const fid_view = new DataView(fid_a);
	for( n=0; n<8;n++)
			{
				fid_view.setUint8(n, f_id[n]);
			}
	const fid = fid_view.getBigInt64(0, true);



	// these 14 bytes turn into 3 float x y z ?? 
	var fxyz = [];
	for(var bi=0; bi<14;bi++)
	{
		fxyz[bi] = fstream[i];
		i++;
	}

	let [xyzs,fbcks] = unbitize7chksum(fxyz,14);
	let fcks = fstream[i];
	i++;
// check checksums. 
	if(fcks != fbcks)
		return false;
	if(fstream[i] != syx_end)
		return false;
	// might have to do this as a uint8 byte array
	const xa = new ArrayBuffer(4);
	const x_view = new DataView(xa);
	for( n=0; n<4;n++)
			{
				x_view.setUint8(n, xyzs[n]);
			}
	let  f_x = x_view.getFloat32(0, true);

	const ya = new ArrayBuffer(4);
	const y_view = new DataView(xa);
	for( n=0; n<4;n++)
			{
				y_view.setUint8(n, xyzs[n+4]);
			}
	let  f_y = y_view.getFloat32(0, true);

// z is   0..1
	const za = new ArrayBuffer(4);
	const z_view = new DataView(za);
	for( n=0; n<4;n++)
			{
				z_view.setUint8(n, xyzs[n+8]);
			}
	let  f_z = z_view.getFloat32(0, true);

// now we have to pack the f_id into a 64bit int, and  xyzs into 3 floats. 
// those floats may be difficult!
//
	etouch.action = action;
	etouch.finger_id=fid;
	etouch.zone=zone;
	etouch.x=f_x;
	etouch.y=f_y;
	etouch.z=f_z;
	return true;
}

//
//  Queries!
// these fire off and the results are picked up in MIDI call back parser.
//

function query_zone_boundary(zone)
{
// F0 00 21 50 00 01 00 01 01 01 04 10 ZONE F7
	const z = zone & 0x7f;
	const cmd = [0x01,0x01,0x04,0x10, z];
	const syx = syx_begin.concat(erae2_prefix).concat(cmd).concat(syx_end);
	if(saved_out_port_id != 0)
	{
	// note_num 0..127, note_vel 0 (or 1) to 127
 	 current_out_port.send(syx,100.0); //omitting the timestamp means send immediately.
	}
}
// parse the response!


//
// drawing Actions!
//
function api_rgb(r,g,b)
{
		return ([ r&0x7f,g&0x7f,b&0x7f])
}
function api_f_rgb(r,g,b)
{
		return ([(127*r)&0x7f,(127*g)&0x7f,(127*b)&0x7f])
}

function draw_pixel_rgb(zone, x,y, r,g,b)
{
	// F0 00 21 50 00 01 00 01 01 01 04 21 ZONE/7 XPOS/7 YPOS/7 RED/7 GREEN/7 BLUE/7 F7
	const z = zone & 0x7f;
	const cmd = [0x01,0x01,0x04,0x21, z,  x &0x7f, y&0x7f].concat(api_rgb(r,g,b));
	const syx = syx_begin.concat(erae2_prefix).concat(cmd).concat(syx_end);

	if(saved_out_port_id != 0)
	{
	// note_num 0..127, note_vel 0 (or 1) to 127
 	 current_out_port.send(syx); //omitting the timestamp means send immediately.
	}
}
function draw_pixel(zone, x,y, col)
{
	// F0 00 21 50 00 01 00 01 01 01 04 21 ZONE/7 XPOS/7 YPOS/7 RED/7 GREEN/7 BLUE/7 F7
	const z = zone & 0x7f;

	const r = (col&0xFF0000)>>16;
	const g = (col&0xFF00)>>8;
	const b = (col&0xFF);

	const cmd = [0x01,0x01,0x04,0x21, z,  x &0x7f, y&0x7f].concat(api_rgb(r,g,b));
	const syx = syx_begin.concat(erae2_prefix).concat(cmd).concat(syx_end);

	if(saved_out_port_id != 0)
	{
	// note_num 0..127, note_vel 0 (or 1) to 127
 	 current_out_port.send(syx); //omitting the timestamp means send immediately.
	}
}

function clear_zone(zone)
{
// F0 00 21 50 00 01 00 01 01 01 04 10 ZONE F7
	const z = zone & 0x7f;
	const cmd = [0x01,0x01,0x04,0x20, z];
	const syx = syx_begin.concat(erae2_prefix).concat(cmd).concat(syx_end);
	if(saved_out_port_id != 0)
	{
	// note_num 0..127, note_vel 0 (or 1) to 127
 	 current_out_port.send(syx,10.0); //omitting the timestamp means send immediately.
	}
}

function draw_rect_rgb(zone, x,y, w,h, r,g,b)
{
// F0 00 21 50 00 01 00 01 01 01 04 22 ZONE F7
	const z = zone & 0x7f;
	const cmd = [0x01,0x01,0x04,0x22, z,  x &0x7f, y&0x7f,w &0x7f, h&0x7f].concat(api_rgb(r,g,b));
	const syx = syx_begin.concat(erae2_prefix).concat(cmd).concat(syx_end);
	if(saved_out_port_id != 0)
	{
	// note_num 0..127, note_vel 0 (or 1) to 127
 	 current_out_port.send(syx); //omitting the timestamp means send immediately.
	}
}

function draw_rect(zone, x,y, w,h, col)
{
// F0 00 21 50 00 01 00 01 01 01 04 22 ZONE F7
	const z = zone & 0x7f;

	const r = (col&0xFF0000)>>16;
	const g = (col&0xFF00)>>8;
	const b = (col&0xFF);

	const cmd = [0x01,0x01,0x04,0x22, z,  x &0x7f, y&0x7f,w &0x7f, h&0x7f].concat(api_rgb(r,g,b));
	const syx = syx_begin.concat(erae2_prefix).concat(cmd).concat(syx_end);
	if(saved_out_port_id != 0)
	{
	// note_num 0..127, note_vel 0 (or 1) to 127
 	 current_out_port.send(syx); //omitting the timestamp means send immediately.
	}
}

//
// image draws top-bot, left-right with 24bit color, expressed here as 32 bit words
// eg: 0x00CCFFCC, 0x0044CCEE 
// limit size to about 32 (8x4, say)
// limit size to about 35 (7x5, would make a nice alphabet)
// limit size to about 30 (6x5, might work anti aliased.)
// that keeps the i/o smaller
// erae is  42x24, 1008 pixels
// 
// imge_data may be larger then the image involved... 
function draw_image(zone, x,y, w,h, image_data)
{
// F0 00 21 50 00 01 00 01 01 01 04 32 ZONE x y w h colors checksum F7
	const z = zone & 0x7f;
	const cmd = [0x01,0x01,0x04,0x23, z,  x &0x7f, y&0x7f, w &0x7f, h&0x7f];
// process image colors: turn into bytetream
	var col_bytes = [];
//	for(ci=0;ci<image_data.length;ci++)
	for(ci=0;ci<(w*h);ci++)
	{
		let t_col = image_data[ci];
		// test!
//		col_bytes.push(0x7f);
//		col_bytes.push(0x4f);
//		col_bytes.push(0x7f);
		col_bytes.push((t_col&0xff0000) >>16);
		col_bytes.push((t_col&0xff00) >>8);
		col_bytes.push((t_col&0xff));
	}
	let [col_midi,cxsum] =  bitize7chksum(col_bytes, col_bytes.length);
	

	const syx = syx_begin.concat(erae2_prefix).concat(cmd)
		.concat(col_midi).concat(cxsum)
		.concat(syx_end);
	if(saved_out_port_id != 0)
	{
	// note_num 0..127, note_vel 0 (or 1) to 127
 	 current_out_port.send(syx); //omitting the timestamp means send immediately.
	}
}

function draw_image_unit()
	{
		e2u_cols = [0xFF, 0xFF, 0xFF,  0xFF, 0x00, 0x00, 0x00, 0xFF, 0x00, 0x00, 0x00, 0xFF];
		e2u_cols3 = [0xFFFFFF,  0xFF0000, 0x00FF00, 0x0000FF];
// test bit izing:
		[e2u_bits,e2u_ck] = bitize7chksum(e2u_cols,e2u_cols.length);
		e2u_rbyte = [];	
		[e2u_rbyte,e2u_ck2] = unbitize7chksum(e2u_bits,e2u_bits.length);


	draw_image(0, 5,3, 2,2, e2u_cols3);
	}
