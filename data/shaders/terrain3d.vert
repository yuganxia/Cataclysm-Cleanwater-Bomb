// Experimental 3D terrain renderer: instanced boxes / cross-quads / yaw-billboards,
// textured from the tileset atlas.  Every geometry family exports a world normal;
// the fragment shader owns the common art-directed lighting model.

#version 450
#extension GL_GOOGLE_include_directive : require

#include "water_waves3d.glsl"

layout(location = 0) in vec3 a_pos;         // box: [0,1]^3 corner; xquad: [0,1]^2 diag x [0,1] up; billboard: x[-.5,.5], y[0,1]
layout(location = 1) in vec3 a_aux;         // box: face normal; xquad/billboard: (u, v, unused)
layout(location = 2) in vec3 a_inst_pos;    // tile grid coords (player-relative); billboard: bottom-center anchor
layout(location = 3) in vec3 a_inst_scale;  // box/xquad: size in meters; billboard: x=width, y=height
layout(location = 4) in vec2 a_inst_uv0;    // atlas uv, top-left
layout(location = 5) in vec2 a_inst_uv1;    // atlas uv, bottom-right
layout(location = 6) in vec4 a_inst_color;  // rgb = tint / untextured fallback color
layout(location = 7) in float a_inst_flags; // bit0: textured; bit1: no cutout; bit2-3: top uv rotation; bit4: side strip; bit8: silhouette side
layout(location = 8) in float a_inst_pad;   // bit4 mode: strip v coordinate (sprite bottom edge)
layout(location = 9) in vec4 a_inst_emission; // rgb = explicit light-source radiance

layout(set = 1, binding = 0) uniform UBO {
    mat4 mvp;
    vec4 cam_right;  // xyz: camera right on the ground plane (billboard facing)
    vec4 cam_up;     // xyz: world up (billboard facing)
    vec4 params;     // x = mode: 0 box, 1 static xquad, 2 yaw billboard, 3 cardinal-snapped billboard, 4 axis quad (fence), 5 flat horizontal quad
    vec4 sun_dir;    // retained in the shared shadow/terrain vertex UBO layout
    vec4 water_vertex; // xy = map origin, z = seconds, w = wave height amplitude
    vec4 water_flow;   // xy = world wind direction, z = normalized speed
};

layout(location = 0) out vec4 v_color;
layout(location = 1) out vec2 v_uv;
layout(location = 2) out float v_flags;
layout(location = 3) out vec3 v_normal;
layout(location = 4) out vec3 v_world;
layout(location = 5) out vec2 v_screen;
layout(location = 6) out float v_wrap;
layout(location = 7) out vec3 v_tile;
layout(location = 8) out vec4 v_emission;

void main()
{
    int mode = int(params.x + 0.5);
    vec3 world;
    vec2 uv_local;
    vec3 normal;
    float wrap = 0.0;
    if( mode == 2 || mode == 3 ) {
        // Yaw billboard: rotate the bottom-centered quad around world-up to face
        // the camera; mode 3 snaps the facing to the nearest cardinal axis.
        vec3 rgt = cam_right.xyz;
        if( mode == 3 ) {
            if( abs( rgt.x ) >= abs( rgt.y ) ) {
                rgt = vec3( sign( rgt.x ), 0.0, 0.0 );
            } else {
                rgt = vec3( 0.0, sign( rgt.y ), 0.0 );
            }
        }
        world = a_inst_pos + rgt * ( a_pos.x * a_inst_scale.x )
              + cam_up.xyz * ( a_pos.y * a_inst_scale.y );
        uv_local = a_aux.xy;
        // A sprite has no real volume.  A slightly upward, camera-facing normal
        // plus wrapped diffuse gives it the same key/fill language as the boxes
        // without turning people and furniture into hard black cutouts.
        normal = normalize( cross( cam_up.xyz, rgt ) + vec3( 0.0, 0.0, 0.30 ) );
        wrap = 0.65;
    } else if( mode == 4 ) {
        // Flat vertical quad standing on a fixed axis (fences): a_inst_pad
        // > 0.5 = runs N-S (quad spans y), else runs E-W (spans x).
        vec3 axis = a_inst_pad > 0.5 ? vec3( 0.0, 1.0, 0.0 ) : vec3( 1.0, 0.0, 0.0 );
        world = a_inst_pos + axis * ( a_pos.x * a_inst_scale.x )
              + cam_up.xyz * ( a_pos.y * a_inst_scale.y );
        int iflags = int( a_inst_flags + 0.5 );
        if( ( iflags & 256 ) != 0 ) {
            uv_local = vec2( a_aux.y, a_aux.x );
        } else {
            uv_local = a_aux.xy;
        }
        normal = a_inst_pad > 0.5 ? vec3( 1.0, 0.0, 0.12 ) : vec3( 0.0, 1.0, 0.12 );
        normal = normalize( normal );
        wrap = 0.40;
    } else if( mode == 5 ) {
        // Flat horizontal quad (floor overlays, cutout floor tiles).
        world = a_inst_pos + vec3( a_pos.x * a_inst_scale.x, a_pos.y * a_inst_scale.y, 0.0 );
        int iflags = int( a_inst_flags + 0.5 );
        int rota = ( iflags >> 2 ) & 3;
        vec2 q = a_pos.xy;
        if( rota == 1 ) {
            q = vec2( q.y, 1.0 - q.x );
        } else if( rota == 2 ) {
            q = vec2( 1.0 - q.x, 1.0 - q.y );
        } else if( rota == 3 ) {
            q = vec2( 1.0 - q.y, q.x );
        }
        uv_local = q;
        normal = vec3( 0.0, 0.0, 1.0 );
    } else if( mode == 1 ) {
        // Static crossed quad pair.  The diagonal identifies which of the two
        // planes owns the vertex; a little upward tilt keeps foliage open to sky.
        world = a_inst_pos + a_pos * a_inst_scale;
        uv_local = a_aux.xy;
        normal = abs( a_pos.x - a_pos.y ) < 0.5
                 ? vec3( 0.7071, -0.7071, 0.20 ) : vec3( 0.7071, 0.7071, 0.20 );
        normal = normalize( normal );
        wrap = 0.55;
    } else {
        // Box: derive face-local uv from the corner position and the face normal.
        world = a_inst_pos + a_pos * a_inst_scale;
        vec3 n = a_aux;
        normal = n;
        int iflags = int( a_inst_flags + 0.5 );
        int rota = ( iflags >> 2 ) & 3;
        if( abs( n.z ) > 0.5 ) {
            vec2 q = a_pos.xy;
            if( rota == 1 ) {
                q = vec2( q.y, 1.0 - q.x );
            } else if( rota == 2 ) {
                q = vec2( 1.0 - q.x, 1.0 - q.y );
            } else if( rota == 3 ) {
                q = vec2( 1.0 - q.y, q.x );
            }
            uv_local = q;
        } else {
            float su = ( abs( n.y ) > 0.5 ) ? a_pos.x : a_pos.y;
            float sv = 1.0 - a_pos.z;
            if( ( iflags & 16 ) != 0 ) {
                sv = ( a_inst_pad - a_inst_uv0.y ) / max( a_inst_uv1.y - a_inst_uv0.y, 1e-6 );
            }
            uv_local = vec2( su, sv );
            if( ( iflags & 32 ) != 0 ) {
                bool wide = ( abs( n.y ) > 0.5 && a_inst_scale.x >= a_inst_scale.y ) ||
                            ( abs( n.x ) > 0.5 && a_inst_scale.y > a_inst_scale.x );
                if( wide ) {
                    uv_local = vec2( uv_local.y, 1.0 - uv_local.x );
                }
            }
        }
    }
    int water_flags = int( a_inst_flags + 0.5 );
    if( water_vertex.w > 0.0 && ( water_flags & 16384 ) != 0 &&
        ( mode == 5 || ( mode == 0 && a_aux.z > 0.5 ) ) ) {
        world.z += water_wave_height( world.xy + water_vertex.xy, water_flow.xy,
                                      water_vertex.z, water_vertex.w, water_flow.z );
    }
    v_tile = a_inst_pos;
    v_normal = normal;
    v_wrap = wrap;
    v_world = world;
    gl_Position = mvp * vec4( world, 1.0 );
    vec2 ndc = gl_Position.xy / gl_Position.w;
    v_screen = vec2( ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5 );
    v_color = a_inst_color;
    v_uv = mix( a_inst_uv0, a_inst_uv1, uv_local );
    int out_flags = int( a_inst_flags + 0.5 );
    if( ( out_flags & 16384 ) != 0 &&
        !( ( mode == 0 && a_aux.z > 0.5 ) || mode == 5 ) ) {
        out_flags &= ~16384;
    }
    v_flags = float( out_flags );
    v_emission = a_inst_emission;
}
