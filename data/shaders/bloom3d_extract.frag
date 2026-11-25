#version 450

layout(set = 2, binding = 0) uniform sampler2D emissive_tex;

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 out_color;

void main()
{
    vec3 emission = max( texture( emissive_tex, v_uv ).rgb, vec3( 0.0 ) );
    float peak = max( emission.r, max( emission.g, emission.b ) );
    const float threshold = 0.8;
    const float knee = 0.4;
    float soft = clamp( peak - threshold + knee, 0.0, 2.0 * knee );
    soft = soft * soft / ( 4.0 * knee + 1.0e-5 );
    float contribution = max( peak - threshold, soft ) / max( peak, 1.0e-5 );
    out_color = vec4( emission * contribution, 1.0 );
}
