module Main exposing (..)

import Html exposing (..)
import Html.Attributes exposing (class)
import LineChart
import LineChart.Dots as Dots
import Color
import Dict exposing (Dict)
import Http
import Json.Decode as Decode


main =
    Html.program
        { init = init "data/repos.json"
        , view = view
        , update = update
        , subscriptions = subscriptions
        }



--- MODEL


type Model
    = Loading
    | Loaded GraphData
    | Error String


type alias GraphData =
    Dict String (List Float)


init : String -> ( Model, Cmd Msg )
init url =
    ( Loading
    , Http.send LoadData (Http.get url decodeData)
    )


decodeData : Decode.Decoder GraphData
decodeData =
    Decode.dict (Decode.list Decode.float)



-- UPDATE


type Msg
    = LoadData (Result Http.Error GraphData)


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        LoadData result ->
            case result of
                Ok graph ->
                    ( Loaded graph, Cmd.none )

                Err err ->
                    ( Error (toString err), Cmd.none )



-- VIEW


view : Model -> Html Msg
view model =
    case model of
        Loading ->
            div [] [ text "loading..." ]

        Loaded graph ->
            div [] [ chart graph ]

        Error message ->
            div [] [ text ("Error:" ++ message) ]


chart : GraphData -> Html.Html msg
chart graph =
    LineChart.view
        (\( key, value ) -> toFloat key)
        (\( key, value ) -> value)
        (graph
            |> Dict.map graphSequenceToLine
            |> Dict.values
        )


graphSequenceToLine : String -> List Float -> LineChart.Series ( Int, Float )
graphSequenceToLine label values =
    LineChart.line Color.red Dots.none label (List.indexedMap (,) values)



-- SUBSCRIPTIONS


subscriptions : Model -> Sub Msg
subscriptions model =
    Sub.none
